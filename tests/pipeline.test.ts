import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sourceConfigSchema, type Profile, type SourceConfig, type SourceKind } from '../src/shared/schemas.js';
import type { AppDeps, MailerFactory, OutgoingMail, Store } from '../src/server/contracts.js';
import { openDatabase } from '../src/server/db/database.js';
import { createStore } from '../src/server/db/store.js';
import { startFixtureServer, type FixtureServer } from '../src/server/demo/server.js';
import { createFileStore } from '../src/server/files.js';
import { HttpClient } from '../src/server/http/client.js';
import { createPipeline } from '../src/server/pipeline/run.js';
import { createScheduler } from '../src/server/pipeline/scheduler.js';
import { createSettings } from '../src/server/settings.js';

const NOW = new Date('2026-06-15T20:00:00Z');
let server: FixtureServer;
const dirs: string[] = [];

beforeAll(async () => {
  server = await startFixtureServer(NOW);
});
afterAll(async () => {
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function sources(): { id: string; name: string; kind: SourceKind; config: Partial<SourceConfig> }[] {
  const u = server.url;
  return [
    { id: 'cb-csv', name: 'Federal tenders', kind: 'canadabuys_csv', config: { url: `${u}/canadabuys/opendata/open.csv`, timeZone: 'America/Toronto', fetchDetails: false } },
    {
      id: 'cb-search',
      name: 'BC Bid notices',
      kind: 'canadabuys_search',
      config: { url: `${u}/canadabuys/en/tender-opportunities?search_filter={query}&words={query}`, queries: ['landscape', 'mowing', 'grounds', 'turf', 'parks'], bcOnly: true, timeZone: 'America/Toronto' },
    },
    { id: 'bf-saanich', name: 'Saanich portal', kind: 'bonfire', config: { url: `${u}/bonfire/saanich`, organization: 'District of Saanich', localBuyer: true, defaultSubmission: 'bonfire', fetchDetails: false } },
    { id: 'bf-victoria', name: 'Victoria portal', kind: 'bonfire', config: { url: `${u}/bonfire/victoria`, organization: 'City of Victoria', localBuyer: true, defaultSubmission: 'bonfire', fetchDetails: false } },
    { id: 'saanich-rss', name: 'Saanich feed', kind: 'rss', config: { url: `${u}/saanich/tenders.rss`, organization: 'District of Saanich', localBuyer: true, defaultSubmission: 'bonfire' } },
    { id: 'crd', name: 'CRD', kind: 'html_list', config: { url: `${u}/crd/contracts-rfps/current`, linkPattern: '^/crd/contracts-rfps/current/[^/?#]+', organization: 'Capital Regional District', localBuyer: true } },
    {
      id: 'esquimalt',
      name: 'Esquimalt',
      kind: 'html_list',
      config: { url: `${u}/esquimalt/business-development/bids-tenders`, linkPattern: '^/esquimalt/business-development/bids-tenders/[^/?#]+', organization: 'Township of Esquimalt', localBuyer: true },
    },
    { id: 'civicinfo', name: 'CivicInfo BC', kind: 'html_list', config: { url: `${u}/civicinfo/bids`, pageParam: 'pn', pageStart: 1, maxPages: 5, bcOnly: true } },
  ];
}

const PROFILE: Partial<Profile> = {
  legalName: 'Garry Oak Grounds Ltd.',
  tradeName: 'Garry Oak Grounds',
  addressLine: '1200 Sample Road',
  city: 'Victoria',
  postalCode: 'V8X 0A1',
  phone: '250-555-0100',
  email: 'office@garryoak.example',
  contactName: 'Robin Example',
  contactTitle: 'Owner',
  signatoryName: 'Robin Example',
  signatoryTitle: 'Owner',
  gstNumber: '000000000 RT0001',
  worksafeNumber: '000000-AA',
  businessLicence: 'Inter-municipal business licence 0000',
  yearEstablished: 2012,
  crewSize: 8,
  insuranceProvider: 'Sample Insurance Co.',
  insurancePolicy: 'CGL-0000',
  insuranceLiability: 5_000_000,
  insuranceExpiry: '2027-03-31',
  about: 'A Victoria landscape maintenance company.',
  references: [
    { client: 'Sample Strata', contactName: 'A. Person', contactInfo: '250-555-0111', description: 'Grounds maintenance', year: '2025', value: '$40,000' },
    { client: 'Sample School', contactName: 'B. Person', contactInfo: '250-555-0112', description: 'Mowing', year: '2024', value: '$25,000' },
    { client: 'Sample Church', contactName: 'C. Person', contactInfo: '250-555-0113', description: 'Garden care', year: '2024', value: '$10,000' },
  ],
  rates: [
    { label: 'Landscape labourer', unit: 'hour', rate: 58 },
    { label: 'Ride-on mower with operator', unit: 'hour', rate: 95 },
  ],
};

const SMTP = { host: 'smtp.garryoak.example', port: 587, secure: false, user: 'office@garryoak.example', pass: 'secret', fromName: 'Garry Oak Grounds', fromEmail: 'office@garryoak.example' };

interface Env {
  deps: AppDeps;
  store: Store;
  sent: OutgoingMail[];
  clock: { now: Date };
  mailFails: { value: boolean };
}

function makeEnv(opts: { profile?: boolean; smtp?: boolean; automation?: Record<string, unknown>; extraSources?: ReturnType<typeof sources> } = {}): Env {
  const dir = mkdtempSync(join(tmpdir(), 'lgbids-pipeline-'));
  dirs.push(dir);
  const store = createStore(openDatabase(':memory:'));
  const clock = { now: NOW };
  const settings = createSettings(store, {}, () => clock.now);
  const sent: OutgoingMail[] = [];
  const mailFails = { value: false };
  let n = 0;
  const mailerFactory: MailerFactory = () => ({
    verify: async () => undefined,
    send: async (mail) => {
      if (mailFails.value) throw new Error('The mail server refused the message.');
      sent.push(mail);
      n += 1;
      return { messageId: `<${n}@test.example>` };
    },
  });
  for (const s of [...sources(), ...(opts.extraSources ?? [])]) {
    store.insertSource({ id: s.id, name: s.name, kind: s.kind, enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse(s.config) }, clock.now);
  }
  if (opts.profile !== false) settings.setProfile(PROFILE);
  if (opts.smtp) settings.setEmail(SMTP);
  if (opts.automation) settings.setAutomation({ ...settings.getAutomation(), ...opts.automation });
  const deps: AppDeps = {
    config: { port: 0, host: '127.0.0.1', dataDir: dir, appPassword: '', timeZone: 'America/Vancouver', demo: false, webDir: '' },
    store,
    settings,
    files: createFileStore(dir),
    mailerFactory,
    httpFactory: () => new HttpClient({ userAgent: 'LgbidsTest/1.0', respectRobots: true, delayMs: 0, retries: 0 }),
    now: () => clock.now,
  };
  return { deps, store, sent, clock, mailFails };
}

describe('explore', () => {
  it('dumps', async () => {
    const env = makeEnv({ smtp: true });
    const pipeline = createPipeline(env.deps);
    const run = await pipeline.run('manual');
    console.log(JSON.stringify(run, null, 1));
    const all = env.store.listOpportunities({ view: 'all', limit: 500 }, NOW).items;
    for (const o of all) {
      console.log(o.id, o.sourceId, '|', o.title, '|', o.noticeType, o.decision, o.suitabilityScore, o.submissionMethod, o.submissionEmail, o.analysis?.pricing, JSON.stringify(o.analysis?.alsoListed), '\n   ', o.analysis?.reasons.map((r) => `${r.tone}:${r.text}`).join(' / '));
    }
    for (const a of env.store.listApplications({})) console.log('APP', a.id, a.opportunity?.title, a.status, a.channel, a.toEmail, JSON.stringify(a.missing), JSON.stringify(a.checklist.map((c) => [c.key, c.required, c.done])));
    console.log('SENT', env.sent.length);
    console.log(env.store.listEvents(50).map((e) => `${e.level} ${e.kind}: ${e.message}`).join('\n'));
  });
});
