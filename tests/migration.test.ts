import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { createDeps } from '../src/server/bootstrap.js';
import type { AppConfig, Pipeline, Scheduler } from '../src/server/contracts.js';
import { openDatabase, SCHEMA_VERSION } from '../src/server/db/database.js';
import { createStore } from '../src/server/db/store.js';
import { parseInsightsDays } from '../src/server/routes/insights.js';
import { createSettings } from '../src/server/settings.js';
import { automationSchema, sourceConfigSchema, type Analysis, type SourceConfig } from '../src/shared/schemas.js';

const NOW = new Date('2026-06-15T17:00:00Z');
const LATER = new Date('2026-06-16T17:00:00Z');

const dirs: string[] = [];
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lgbids-migration-'));
  dirs.push(dir);
  return join(dir, 'lgbids.sqlite');
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function memoryStore() {
  return createStore(openDatabase(':memory:'));
}

function analysis(over: Partial<Analysis> = {}): Analysis {
  return {
    relevance: 80,
    matchedTerms: ['mowing'],
    services: ['lawn'],
    area: 'yes',
    areaMatch: 'Saanich',
    reasons: [],
    requirements: [],
    pricing: 'lump_sum',
    alsoListed: [],
    ...over,
  };
}

function addOpportunity(store: ReturnType<typeof memoryStore>, title: string, score: number, a: Analysis, location = ''): number {
  const { id } = store.upsertOpportunity('src', { externalId: title, title, url: `https://town.example/${title}`, location, status: 'open' }, false, NOW);
  store.saveAnalysis(id, { noticeType: 'RFQ', score, decision: 'suitable', analysis: a, submissionMethod: 'email', submissionEmail: '', submissionUrl: '' }, NOW);
  return id;
}

const V2_TABLES = ['opportunity_changes', 'reminders_sent', 'feedback', 'awards', 'saved_searches', 'recipients'];

describe('migration 3', () => {
  it('upgrades a schema-2 database, keeps its data and starts the new tables empty', () => {
    const path = tempDb();
    const old = openDatabase(path, { upTo: 2 });
    old.run(
      `INSERT INTO sources (id, name, kind, enabled, builtin, notes, config, created_at, updated_at)
       VALUES ('saanich', 'Saanich', 'rss', 1, 1, '', '{"url":"https://old.example/feed"}', :at, :at)`,
      { at: NOW.toISOString() },
    );
    old.run(
      `INSERT INTO opportunities (source_id, external_id, title, first_seen_at, last_seen_at) VALUES ('saanich', 'a', 'Park mowing', :at, :at)`,
      { at: NOW.toISOString() },
    );
    expect(old.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")?.value).toBe('2');
    old.close();

    const db = openDatabase(path);
    expect(db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")?.value).toBe(String(SCHEMA_VERSION));
    expect(SCHEMA_VERSION).toBe(3);
    expect(db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'keys_version'")?.value).toBe('1');
    for (const table of V2_TABLES) expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n).toBe(0);
    const source = db.get<{ name: string; default_config: string | null }>("SELECT name, default_config FROM sources WHERE id = 'saanich'");
    expect(source).toEqual({ name: 'Saanich', default_config: null });

    const store = createStore(db);
    const [opp] = store.listOpportunities({}, NOW).items;
    expect(opp).toMatchObject({ title: 'Park mowing', alertsMuted: false, unseenChanges: 0, lastChangedAt: null });
    store.close();

    // Opening again changes nothing.
    const again = openDatabase(path);
    expect(again.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")?.value).toBe('3');
    again.close();
  });
});

describe('v2 store CRUD', () => {
  it('records changes, mutes alerts and marks changes seen', () => {
    const store = memoryStore();
    const id = addOpportunity(store, 'Mowing', 80, analysis());
    expect(store.setAlertsMuted(id, true)).toBe(true);
    expect(store.setAlertsMuted(9999, true)).toBe(false);
    const moved = store.addChange({
      opportunityId: id,
      kind: 'closing_moved',
      summary: 'The closing date moved.',
      before: '2026-06-20',
      after: '2026-06-27',
      addendum: false,
      detectedAt: NOW.toISOString(),
      runId: null,
    });
    store.addChange({ opportunityId: id, kind: 'closing_refined', summary: '', before: '', after: '', addendum: false, detectedAt: LATER.toISOString(), runId: null });
    expect(moved).toMatchObject({ kind: 'closing_moved', notifiedAt: null, seenAt: null });
    expect(store.listChanges(id).map((c) => c.kind)).toEqual(['closing_refined', 'closing_moved']);
    expect(store.getOpportunity(id)).toMatchObject({ alertsMuted: true, unseenChanges: 1, lastChangedAt: NOW.toISOString() });
    expect(store.countUnseenChanges()).toBe(1);
    expect(store.unnotifiedChanges()).toHaveLength(2);
    store.markChangesNotified([moved.id], NOW);
    expect(store.unnotifiedChanges()).toHaveLength(1);
    expect(store.markChangesSeen(id, NOW)).toBe(2);
    expect(store.countUnseenChanges()).toBe(0);
  });

  it('keeps one reminder per bid, threshold and closing time', () => {
    const store = memoryStore();
    const id = addOpportunity(store, 'Mowing', 80, analysis());
    const closesAt = '2026-06-20T21:00:00.000Z';
    expect(store.reminderSent(id, 72, closesAt)).toBe(false);
    store.recordReminder({ opportunityId: id, thresholdHours: 72, closesAt, sentAt: NOW.toISOString(), channels: ['push'] });
    store.recordReminder({ opportunityId: id, thresholdHours: 72, closesAt, sentAt: LATER.toISOString(), channels: ['push', 'email'] });
    expect(store.reminderSent(id, 72, closesAt)).toBe(true);
    // A moved closing re-arms it.
    expect(store.reminderSent(id, 72, '2026-06-27T21:00:00.000Z')).toBe(false);
    expect(store.listReminders(id)).toEqual([{ opportunityId: id, thresholdHours: 72, closesAt, sentAt: LATER.toISOString(), channels: ['push', 'email'] }]);
  });

  it('saves, replaces, lists and deletes feedback', () => {
    const store = memoryStore();
    const id = addOpportunity(store, 'Mowing', 80, analysis());
    const base = {
      opportunityId: id,
      verdict: 'not_relevant' as const,
      reasons: ['not_our_work' as const],
      note: '',
      title: 'Mowing',
      url: '',
      organization: '',
      foundVia: '',
      sourceId: 'src',
      noticeType: 'RFQ' as const,
      score: 80,
      decision: 'suitable' as const,
      matchedTerms: ['mowing'],
      services: ['lawn' as const],
      area: 'yes' as const,
      areaMatch: 'Saanich',
      trace: null,
      lexiconVersion: 'abc',
    };
    store.saveFeedback(base, NOW);
    const replaced = store.saveFeedback({ ...base, reasons: ['outside_area'] }, LATER);
    store.saveFeedback({ ...base, opportunityId: null, verdict: 'missed', reasons: [], title: 'Missed bid' }, LATER);
    expect(store.getFeedbackFor(id)).toEqual(replaced);
    expect(replaced.reasons).toEqual(['outside_area']);
    expect(store.listFeedback()).toHaveLength(2);
    expect(store.listFeedback({ sinceIso: '2026-06-16T00:00:00Z' })).toHaveLength(2);
    expect(store.listFeedback({ sinceIso: '2026-06-17T00:00:00Z' })).toHaveLength(0);
    expect(store.deleteFeedbackFor(id)).toBe(true);
    expect(store.getFeedbackFor(id)).toBeUndefined();
    expect(store.listFeedback()).toHaveLength(1);
  });

  it('saves one award per opportunity', () => {
    const store = memoryStore();
    const id = addOpportunity(store, 'Mowing', 80, analysis());
    const award = {
      opportunityId: id,
      noticeOpportunityId: null,
      orgKey: 'saanich',
      refKey: '',
      title: 'Mowing',
      winner: 'Green Co',
      amount: 12000,
      amountText: '$12,000',
      awardedOn: '2026-06-10',
      url: '',
      excerpt: '',
      origin: 'parsed' as const,
      status: 'suggested' as const,
      notes: '',
    };
    store.saveAward(award, NOW);
    const confirmed = store.saveAward({ ...award, origin: 'manual', status: 'confirmed', winner: 'Blue Co' }, LATER);
    expect(store.getAwardFor(id)).toEqual(confirmed);
    expect(store.listAwards()).toHaveLength(1);
    expect(store.deleteAwardFor(id)).toBe(true);
    expect(store.getAwardFor(id)).toBeUndefined();
  });

  it('creates saved searches with unique names, updates and deletes them', () => {
    const store = memoryStore();
    const a = store.createSavedSearch({ name: 'Lawns', filter: { view: 'suitable', q: '', sourceId: '', closingWithinDays: null, minScore: 60, service: 'lawn', place: '' } }, NOW);
    expect(a).toMatchObject({ name: 'Lawns', position: 0, filter: { minScore: 60, service: 'lawn' } });
    expect(store.createSavedSearch({ name: 'lawns', filter: automationFreeFilter() }, NOW)).toBeNull();
    const b = store.createSavedSearch({ name: 'Trees', filter: automationFreeFilter() }, NOW)!;
    expect(b.position).toBe(1);
    expect(store.updateSavedSearch(b.id, { name: 'LAWNS' })).toBeNull();
    expect(store.updateSavedSearch(999, { name: 'x' })).toBeUndefined();
    expect(store.updateSavedSearch(b.id, { name: 'Big trees', position: 5 })).toMatchObject({ name: 'Big trees', position: 5 });
    expect(store.listSavedSearches().map((s) => s.name)).toEqual(['Lawns', 'Big trees']);
    expect(store.deleteSavedSearch(a!.id)).toBe(true);
    expect(store.listSavedSearches()).toHaveLength(1);
  });

  it('creates, updates, verifies and deletes recipients', () => {
    const store = memoryStore();
    const r = store.createRecipient({ name: 'Sam', email: 'sam@example.com', channel: 'ntfy', chatIdOrTopic: 'bids', kinds: ['new'], savedSearchId: null }, NOW);
    store.markRecipientVerified(r.id, NOW);
    expect(store.updateRecipient(r.id, { kinds: ['new', 'reminders'] })).toMatchObject({ kinds: ['new', 'reminders'], verifiedAt: '2026-06-15T17:00:00Z' });
    // A new topic has not been tested.
    expect(store.updateRecipient(r.id, { chatIdOrTopic: 'other' })?.verifiedAt).toBeNull();
    expect(store.updateRecipient(999, { name: 'x' })).toBeUndefined();
    expect(store.listRecipients()).toHaveLength(1);
    expect(store.deleteRecipient(r.id)).toBe(true);
    expect(store.getRecipient(r.id)).toBeUndefined();
  });

  it('keeps meta values and signs everyone out', () => {
    const store = memoryStore();
    expect(store.getMeta('keys_version')).toBe('1');
    store.setMeta('keys_version', '2');
    expect(store.getMeta('keys_version')).toBe('2');
    store.createSession('a', LATER, NOW);
    store.createSession('b', LATER, NOW);
    expect(store.deleteAllSessions()).toBe(2);
    expect(store.sessionValid('a', NOW)).toBe(false);
  });

  it('filters the list by score, service and place', () => {
    const store = memoryStore();
    addOpportunity(store, 'Mowing', 80, analysis({ services: ['lawn'], areaMatch: 'Saanich' }));
    addOpportunity(store, 'Pruning', 50, analysis({ services: ['tree'], areaMatch: '' }), 'Oak Bay');
    const titles = (filter: Parameters<typeof store.listOpportunities>[0]) => store.listOpportunities(filter, NOW).items.map((o) => o.title).sort();
    expect(titles({ minScore: 60 })).toEqual(['Mowing']);
    expect(titles({ service: 'tree' })).toEqual(['Pruning']);
    expect(titles({ place: 'saanich' })).toEqual(['Mowing']);
    expect(titles({ place: 'OAK' })).toEqual(['Pruning']);
    expect(titles({ place: '%' })).toEqual([]);
  });
});

function automationFreeFilter() {
  return { view: 'all' as const, q: '', sourceId: '', closingWithinDays: null, minScore: null, service: null, place: '' };
}

describe('COV-11: built-in source settings reach existing installs', () => {
  const config = (url: string): SourceConfig => sourceConfigSchema.parse({ url });
  const builtin = (url: string, extra: { enabled?: boolean; forceOff?: boolean; name?: string } = {}) => ({
    id: 'oakbay',
    name: extra.name ?? 'Oak Bay',
    kind: 'html_list' as const,
    notes: 'note',
    config: config(url),
    ...(extra.enabled !== undefined ? { enabled: extra.enabled } : {}),
    ...(extra.forceOff ? { forceOff: true } : {}),
  });

  it('gives an untouched built-in source the new address and name', () => {
    const store = memoryStore();
    store.seedSources([builtin('https://old.example/bids', { enabled: false })], NOW);
    store.setSourceState('oakbay', { etag: 'x' });
    store.seedSources([builtin('https://new.example/bids', { enabled: false, name: 'Oak Bay (new)' })], LATER);
    const s = store.getSource('oakbay')!;
    expect(s.config.url).toBe('https://new.example/bids');
    expect(s.name).toBe('Oak Bay (new)');
    expect(s.enabled).toBe(false);
    expect(store.getSourceState('oakbay')).toEqual({});
  });

  it('keeps the config of a built-in source the user edited, and its on/off choice', () => {
    const store = memoryStore();
    store.seedSources([builtin('https://old.example/bids', { enabled: false })], NOW);
    store.updateSource('oakbay', { enabled: true, config: config('https://mine.example/bids') }, LATER);
    store.seedSources([builtin('https://new.example/bids', { enabled: false })], LATER);
    const s = store.getSource('oakbay')!;
    expect(s.config.url).toBe('https://mine.example/bids');
    expect(s.enabled).toBe(true);
    // A later fix still does not overwrite it.
    store.seedSources([builtin('https://newer.example/bids', { enabled: false })], LATER);
    expect(store.getSource('oakbay')!.config.url).toBe('https://mine.example/bids');
  });

  it('turning a source on does not stop fixes reaching it', () => {
    const store = memoryStore();
    store.seedSources([builtin('https://old.example/bids', { enabled: false })], NOW);
    store.updateSource('oakbay', { enabled: true }, LATER);
    store.seedSources([builtin('https://new.example/bids', { enabled: false })], LATER);
    expect(store.getSource('oakbay')).toMatchObject({ enabled: true, config: { url: 'https://new.example/bids' } });
  });

  it('keeps the forced-off rules', () => {
    const store = memoryStore();
    store.seedSources([builtin('https://old.example/bids')], NOW);
    expect(store.getSource('oakbay')!.enabled).toBe(true);
    store.seedSources([builtin('https://old.example/bids', { forceOff: true })], NOW);
    expect(store.getSource('oakbay')!.enabled).toBe(false);
    store.updateSource('oakbay', { enabled: true }, LATER);
    store.seedSources([builtin('https://old.example/bids', { forceOff: true })], LATER);
    expect(store.getSource('oakbay')!.enabled).toBe(false);
  });

  it('never touches a user-added source', () => {
    const store = memoryStore();
    store.insertSource({ id: 'oakbay', name: 'Mine', kind: 'rss', enabled: true, builtin: false, notes: '', config: config('https://mine.example/feed') }, NOW);
    store.seedSources([builtin('https://new.example/bids', { forceOff: true })], LATER);
    expect(store.getSource('oakbay')).toMatchObject({ name: 'Mine', enabled: true, notes: '', config: { url: 'https://mine.example/feed' } });
  });

  it('upgrades a v1 row: never edited gets the fix, edited keeps its config', () => {
    const path = tempDb();
    const old = openDatabase(path, { upTo: 2 });
    const insert = (id: string, updated: string) =>
      old.run(
        `INSERT INTO sources (id, name, kind, enabled, builtin, notes, config, created_at, updated_at)
         VALUES (:id, 'Old', 'html_list', 1, 1, '', :config, :created, :updated)`,
        { id, config: JSON.stringify(config('https://old.example/bids')), created: NOW.toISOString(), updated: updated },
      );
    insert('a', NOW.toISOString());
    insert('b', LATER.toISOString());
    old.close();
    const store = createStore(openDatabase(path));
    store.seedSources([{ ...builtin('https://new.example/bids'), id: 'a' }, { ...builtin('https://new.example/bids'), id: 'b' }], LATER);
    expect(store.getSource('a')!.config.url).toBe('https://new.example/bids');
    expect(store.getSource('b')!.config.url).toBe('https://old.example/bids');
    store.close();
  });
});

describe('v2 settings', () => {
  it('validates the app address', () => {
    const parse = (appUrl: string) => automationSchema.safeParse({ appUrl });
    expect(parse('https://bids.example.com/').data?.appUrl).toBe('https://bids.example.com');
    expect(parse('http://localhost:3000').success).toBe(true);
    expect(parse('http://192.168.1.20:3000').success).toBe(true);
    expect(parse('http://nas.local').success).toBe(true);
    expect(parse('').success).toBe(true);
    const bad = parse('http://bids.example.com');
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/must start with https:\/\//);
    expect(parse('not a url').success).toBe(false);
  });

  it('defaults the v2 notification fields, and maps "0 reminder days" to no reminders', () => {
    const fresh = automationSchema.parse({});
    expect(fresh).toMatchObject({ notifyReminders: true, notifyChanges: true, reminderHours: [72, 24], appUrl: '' });
    expect(automationSchema.parse({ reminderHours: [24, 72, 24] }).reminderHours).toEqual([72, 24]);
    const store = memoryStore();
    store.setSetting('automation', { mode: 'prepare', deadlineReminderDays: 0 }, NOW);
    expect(createSettings(store, {}).getAutomation().reminderHours).toEqual([]);
    store.setSetting('automation', { mode: 'prepare', deadlineReminderDays: 3 }, NOW);
    expect(createSettings(store, {}).getAutomation().reminderHours).toEqual([72, 24]);
  });

  it('answers 400 with a sentence for a bad app address', async () => {
    const app = await testApp();
    const res = await app.inject({ method: 'PUT', url: '/api/settings/automation', payload: { appUrl: 'http://bids.example.com' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/https:\/\/.*\.$/);
    await app.close();
  });
});

async function testApp() {
  const config: AppConfig = { port: 0, host: '127.0.0.1', dataDir: ':memory:', appPassword: '', timeZone: 'America/Vancouver', demo: false, webDir: '' };
  const deps = createDeps(config, { now: () => NOW });
  const pipeline = { isRunning: () => false } as unknown as Pipeline;
  const scheduler = { reschedule() {}, nextRunAt: () => null, start() {}, stop() {} } as Scheduler;
  return buildApp(deps, pipeline, scheduler);
}

describe('v2 routes', () => {
  it('registers every route not built yet, answering 501 "Not built yet."', async () => {
    const app = await testApp();
    for (const [method, url] of [
      ['GET', '/api/saved-searches'],
      ['POST', '/api/saved-searches'],
      ['PATCH', '/api/saved-searches/1'],
      ['DELETE', '/api/saved-searches/1'],
      ['GET', '/api/coverage'],
      ['GET', '/api/recipients'],
      ['POST', '/api/recipients'],
      ['PATCH', '/api/recipients/1'],
      ['DELETE', '/api/recipients/1'],
      ['POST', '/api/recipients/1/test'],
      ['GET', '/api/status'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(501);
      expect(res.json()).toEqual({ error: 'Not built yet.' });
    }
    await app.close();
  });

  it('serves insights with every list present, and validates days', async () => {
    expect(parseInsightsDays(undefined)).toBe(30);
    expect(parseInsightsDays('7')).toBe(7);
    expect(parseInsightsDays('all')).toBe('all');
    expect(() => parseInsightsDays('14')).toThrow(/7, 30 or all/);
    const app = await testApp();
    const scoring = await app.inject({ method: 'GET', url: '/api/insights/scoring?days=7' });
    expect(scoring.statusCode).toBe(200);
    expect(scoring.json()).toMatchObject({ days: 7, counts: { total: 0 }, terms: [], suggestions: [], rescore: { items: [] } });
    expect((await app.inject({ method: 'GET', url: '/api/insights/scoring?days=14' })).statusCode).toBe(400);
    const results = await app.inject({ method: 'GET', url: '/api/insights/results' });
    expect(results.json()).toMatchObject({ submitted: 0, winRate: null, recent: [] });
    await app.close();
  });

  it('seeds the built-in "added by hand" source', async () => {
    const app = await testApp();
    const sources = (await app.inject({ method: 'GET', url: '/api/sources' })).json() as { id: string; kind: string; enabled: boolean }[];
    expect(sources.find((s) => s.id === 'manual')).toMatchObject({ kind: 'manual', enabled: true });
    await app.close();
  });
});
