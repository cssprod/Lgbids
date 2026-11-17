import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { createDeps } from '../src/server/bootstrap.js';
import type { AppConfig, AppDeps, Mailer, OutgoingMail, Pipeline, Scheduler, SendResult, SourceTestResult } from '../src/server/contracts.js';
import { sourceConfigSchema, type Analysis, type Application, type Decision, type SourceRecord } from '../src/shared/schemas.js';

const NOW = new Date('2026-06-15T20:00:00Z');
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z');

const baseConfig: AppConfig = {
  port: 0,
  host: '127.0.0.1',
  dataDir: ':memory:',
  appPassword: '',
  timeZone: 'America/Vancouver',
  demo: false,
  webDir: '',
};

// ---------------------------------------------------------------------------
// Fakes: the pipeline and scheduler only record what the routes asked of them.
// ---------------------------------------------------------------------------

interface FakePipeline extends Pipeline {
  calls: { method: string; args: unknown[] }[];
  running: boolean;
  sendResult: SendResult;
}

function fakePipeline(deps: AppDeps): FakePipeline {
  const fake: FakePipeline = {
    calls: [],
    running: false,
    sendResult: { ok: true, error: '' },
    async run(trigger) {
      fake.calls.push({ method: 'run', args: [trigger] });
      return deps.store.startRun(trigger, deps.now());
    },
    isRunning: () => fake.running,
    async testSource(source: SourceRecord): Promise<SourceTestResult> {
      fake.calls.push({ method: 'testSource', args: [source] });
      return {
        status: 'ok',
        message: 'Read 1 notice.',
        ms: 12,
        count: 1,
        sample: [{ title: 'Park mowing', url: 'https://town.example/bids/1', organization: 'Town', closesAt: null, closingRaw: '', referenceNumber: '' }],
        requests: [],
      };
    },
    async refreshOpportunity(id) {
      fake.calls.push({ method: 'refreshOpportunity', args: [id] });
    },
    draftFor(opportunityId, opts) {
      fake.calls.push({ method: 'draftFor', args: [opportunityId, opts] });
      return deps.store.getApplicationByOpportunity(opportunityId) ?? createApp(deps, opportunityId);
    },
    reassess(applicationId) {
      fake.calls.push({ method: 'reassess', args: [applicationId] });
      return deps.store.getApplication(applicationId)!;
    },
    async send(applicationId, opts) {
      fake.calls.push({ method: 'send', args: [applicationId, opts] });
      if (fake.sendResult.ok) deps.store.transitionApplication(applicationId, ['ready'], 'submitted', deps.now());
      return fake.sendResult;
    },
    async packagePdf(applicationId) {
      fake.calls.push({ method: 'packagePdf', args: [applicationId] });
      return { filename: `Application ${applicationId}.pdf`, content: Buffer.from('%PDF-1.4\n%%EOF\n') };
    },
  };
  return fake;
}

interface FakeScheduler extends Scheduler {
  reschedules: number;
}

function fakeScheduler(): FakeScheduler {
  const fake: FakeScheduler = {
    reschedules: 0,
    start() {},
    stop() {},
    reschedule() {
      fake.reschedules += 1;
    },
    nextRunAt: () => at(6),
  };
  return fake;
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const SOURCE_ID = 'test-source';

function analysis(): Analysis {
  return {
    relevance: 80,
    matchedTerms: ['mowing'],
    services: ['lawn'],
    area: 'yes',
    areaMatch: 'Saanich',
    reasons: [{ tone: 'good', text: 'Mowing work in Saanich.' }],
    requirements: [],
    pricing: 'lump_sum',
    alsoListed: [],
  };
}

function seedOpportunity(
  deps: AppDeps,
  opts: { title: string; closesAt?: string | null; precision?: 'date' | 'datetime'; decision?: Decision; externalId?: string; sourceId?: string },
): number {
  const { id } = deps.store.upsertOpportunity(
    opts.sourceId ?? SOURCE_ID,
    {
      externalId: opts.externalId ?? opts.title,
      title: opts.title,
      url: `https://town.example/bids/${encodeURIComponent(opts.externalId ?? opts.title)}`,
      organization: 'District of Saanich',
      referenceNumber: 'RFQ 26-1',
      description: 'Mowing and trimming of parks, boulevards; and more.',
      closing: opts.closesAt === null ? null : { iso: opts.closesAt ?? at(24 * 10), precision: opts.precision ?? 'datetime' },
      closingRaw: 'June 25, 2026 2:00 PM',
      status: 'open',
    },
    false,
    NOW,
  );
  deps.store.saveAnalysis(
    id,
    {
      noticeType: 'RFQ',
      score: opts.decision === 'unsuitable' ? 10 : 80,
      decision: opts.decision ?? 'suitable',
      analysis: analysis(),
      submissionMethod: 'email',
      submissionEmail: 'bids@saanich.example',
      submissionUrl: '',
    },
    NOW,
  );
  return id;
}

function createApp(deps: AppDeps, opportunityId: number, status: Application['status'] = 'ready'): Application {
  return deps.store.createApplication(
    {
      opportunityId,
      status,
      channel: 'email',
      toEmail: 'bids@saanich.example',
      ccEmail: '',
      subject: 'Quotation: Park mowing',
      body: 'Please find our quotation attached.',
      includeRates: false,
      checklist: [
        { key: 'forms', label: 'Sign the bid form', detail: '', done: false, required: true },
        { key: 'site_meeting', label: 'Attend the site meeting', detail: '', done: false, required: true },
      ],
      documentIds: [],
      missing: [],
      autoGenerated: true,
    },
    NOW,
  );
}

// ---------------------------------------------------------------------------
// Multipart bodies for inject
// ---------------------------------------------------------------------------

function multipart(fields: Record<string, string>, file?: { name: string; type: string; content: Buffer }) {
  const boundary = '----lgbidsTestBoundary7MA4YWxk';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.content, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

// ---------------------------------------------------------------------------

interface Harness {
  app: FastifyInstance;
  deps: AppDeps;
  pipeline: FakePipeline;
  scheduler: FakeScheduler;
  sent: OutgoingMail[];
}

const open: Harness[] = [];

async function harness(config: Partial<AppConfig> = {}, mailer?: Partial<Mailer>): Promise<Harness> {
  const sent: OutgoingMail[] = [];
  const deps = createDeps(
    { ...baseConfig, ...config },
    {
      now: () => NOW,
      mailerFactory: () => ({
        verify: mailer?.verify ?? (async () => {}),
        send:
          mailer?.send ??
          (async (mail) => {
            sent.push(mail);
            return { messageId: '<test@lgbids.example>' };
          }),
      }),
    },
  );
  deps.store.insertSource(
    { id: SOURCE_ID, name: 'Test source', kind: 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({ url: 'https://town.example/bids' }) },
    NOW,
  );
  const pipeline = fakePipeline(deps);
  const scheduler = fakeScheduler();
  const app = await buildApp(deps, pipeline, scheduler);
  const h = { app, deps, pipeline, scheduler, sent };
  open.push(h);
  return h;
}

afterEach(async () => {
  for (const h of open.splice(0)) {
    await h.app.close();
    h.deps.store.close();
  }
});

describe('sign-in', () => {
  it('is open when no password is set', async () => {
    const { app } = await harness();
    const session = await app.inject({ method: 'GET', url: '/api/session' });
    expect(session.json()).toEqual({ authRequired: false, authenticated: true, demo: false });
    expect((await app.inject({ method: 'GET', url: '/api/sources' })).statusCode).toBe(200);
  });

  it('answers the health check without signing in', async () => {
    const { app } = await harness({ appPassword: 'secret-pass-123' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('protects the API, signs in with a cookie and signs out', async () => {
    const { app } = await harness({ appPassword: 'correct horse' });
    expect((await app.inject({ method: 'GET', url: '/api/session' })).json()).toMatchObject({ authRequired: true, authenticated: false });
    const blocked = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error).toMatch(/sign in/i);

    const wrong = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe('That password is not correct.');

    const ok = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'correct horse' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ authRequired: true, authenticated: true });
    const cookie = ok.cookies.find((c) => c.name === 'lgbids_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookie.value).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(cookie.expires!).getTime() - NOW.getTime()).toBe(30 * 24 * HOUR);

    const headers = { cookie: `lgbids_session=${cookie.value}` };
    expect((await app.inject({ method: 'GET', url: '/api/dashboard', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/session', headers })).json().authenticated).toBe(true);

    const out = await app.inject({ method: 'POST', url: '/api/logout', headers });
    expect(out.json().authenticated).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/dashboard', headers })).statusCode).toBe(401);
  });

  it('locks out an address after five wrong passwords', async () => {
    const { app } = await harness({ appPassword: 'secret' });
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'POST', url: '/api/login', payload: { password: `guess${i}` } })).statusCode).toBe(401);
    }
    const locked = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'secret' } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toMatch(/Too many wrong passwords/);
  });

  it('refuses state-changing requests from another origin', async () => {
    const { app } = await harness();
    const foreign = await app.inject({ method: 'POST', url: '/api/runs', headers: { origin: 'https://evil.example' } });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error).toMatch(/another website/);
    const same = await app.inject({ method: 'POST', url: '/api/runs', headers: { origin: 'http://localhost:80', host: 'localhost:80' } });
    expect(same.statusCode).toBe(202);
    // Reading is fine from anywhere the browser allows.
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: { origin: 'https://evil.example' } })).statusCode).toBe(200);
  });

  it('sets security headers on every response', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'GET', url: '/api/session' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

describe('profile and settings', () => {
  it('round-trips the profile and reports what is missing', async () => {
    const { app } = await harness();
    const before = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(before.json().profile.province).toBe('BC');
    expect(before.json().missing.length).toBeGreaterThan(0);

    const saved = await app.inject({ method: 'PUT', url: '/api/profile', payload: { ...before.json().profile, legalName: 'Garry Oak Gardens Ltd.', email: 'bids@garryoak.example' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().profile.legalName).toBe('Garry Oak Gardens Ltd.');
    expect(Array.isArray(saved.json().missing)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/profile' })).json().profile.legalName).toBe('Garry Oak Gardens Ltd.');
  });

  it('answers a validation error with a sentence naming the field', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'PUT', url: '/api/profile', payload: { legalName: 'x'.repeat(300) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^Please check “legalName”: .+\.$/);
    const bad = await app.inject({ method: 'PUT', url: '/api/profile', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('The request body is not valid JSON.');
  });

  it('saves automation and region settings and reschedules', async () => {
    const { app, scheduler } = await harness();
    const automation = (await app.inject({ method: 'GET', url: '/api/settings/automation' })).json();
    expect(automation.mode).toBe('prepare');
    const put = await app.inject({ method: 'PUT', url: '/api/settings/automation', payload: { ...automation, mode: 'discover', intervalHours: 12 } });
    expect(put.json()).toMatchObject({ mode: 'discover', intervalHours: 12 });
    expect(scheduler.reschedules).toBe(1);
    const invalid = await app.inject({ method: 'PUT', url: '/api/settings/automation', payload: { mode: 'yolo' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toContain('“mode”');

    const region = (await app.inject({ method: 'GET', url: '/api/settings/region' })).json();
    expect(region.places.length).toBeGreaterThan(5);
    const custom = await app.inject({ method: 'PUT', url: '/api/settings/region', payload: { places: ['Saanich'], excludePlaces: [], organizations: [] } });
    expect(custom.json().places).toEqual(['Saanich']);
    const reset = await app.inject({ method: 'POST', url: '/api/settings/region/reset' });
    expect(reset.json().places.length).toBe(region.places.length);
    expect(scheduler.reschedules).toBe(3);
  });

  it('never returns the SMTP password and keeps it when the field is left empty', async () => {
    const { app, deps } = await harness();
    const email = { host: 'smtp.example', port: 587, secure: false, user: 'me', pass: 's3cret', fromName: 'Garry Oak', fromEmail: 'bids@garryoak.example', replyTo: '', bccSelf: true };
    const saved = await app.inject({ method: 'PUT', url: '/api/settings/email', payload: email });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).not.toHaveProperty('pass');
    expect(saved.json()).toMatchObject({ hasPassword: true, host: 'smtp.example', fromEnvironment: expect.any(Array) });
    expect(saved.body).not.toContain('s3cret');

    const kept = await app.inject({ method: 'PUT', url: '/api/settings/email', payload: { ...email, pass: '', fromName: 'Garry Oak Gardens' } });
    expect(kept.json()).toMatchObject({ hasPassword: true, fromName: 'Garry Oak Gardens' });
    expect(deps.settings.getEmail().pass).toBe('s3cret');
    expect((await app.inject({ method: 'GET', url: '/api/settings/email' })).body).not.toContain('s3cret');

    const badFrom = await app.inject({ method: 'PUT', url: '/api/settings/email', payload: { ...email, fromEmail: 'not an address' } });
    expect(badFrom.statusCode).toBe(400);
  });

  it('sends a test e-mail and stamps the settings as verified', async () => {
    const { app, sent, deps } = await harness();
    const notSet = await app.inject({ method: 'POST', url: '/api/settings/email/test', payload: {} });
    expect(notSet.json()).toMatchObject({ ok: false });

    await app.inject({ method: 'PUT', url: '/api/settings/email', payload: { host: 'smtp.example', port: 587, user: 'me', pass: 'pw', fromEmail: 'bids@garryoak.example' } });
    const res = await app.inject({ method: 'POST', url: '/api/settings/email/test', payload: { to: 'owner@garryoak.example' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['owner@garryoak.example']);
    expect(deps.settings.getEmail().verifiedAt).toBe('2026-06-15T20:00:00Z');
    expect(deps.settings.getEmail().pass).toBe('pw');
  });

  it('reports a failed e-mail test as a sentence with HTTP 200', async () => {
    const { app } = await harness({}, { verify: async () => Promise.reject(new Error('Could not connect to the mail server at smtp.example:587. Check the host name and port.')) });
    await app.inject({ method: 'PUT', url: '/api/settings/email', payload: { host: 'smtp.example', port: 587, fromEmail: 'bids@garryoak.example' } });
    const res = await app.inject({ method: 'POST', url: '/api/settings/email/test' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, message: 'Could not connect to the mail server at smtp.example:587. Check the host name and port.' });
  });
});

describe('sources', () => {
  it('creates, edits, tests and deletes a source', async () => {
    const { app, pipeline } = await harness();
    const list = (await app.inject({ method: 'GET', url: '/api/sources' })).json() as SourceRecord[];
    expect(list.some((s) => s.builtin)).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { name: 'Town of Example bids', kind: 'html_list', config: { url: 'https://town.example/bids', linkPattern: '^/bids/' } },
    });
    expect(created.statusCode).toBe(200);
    const source = created.json() as SourceRecord;
    expect(source.id).toMatch(/^town-of-example-bids-[0-9a-f]{6}$/);
    expect(source).toMatchObject({ builtin: false, enabled: true });

    const patched = await app.inject({ method: 'PATCH', url: `/api/sources/${source.id}`, payload: { enabled: false, config: { maxPages: 3 } } });
    expect(patched.json()).toMatchObject({ enabled: false, config: { maxPages: 3, url: 'https://town.example/bids', linkPattern: '^/bids/' } });

    const tested = await app.inject({ method: 'POST', url: `/api/sources/${source.id}/test` });
    expect(tested.json()).toMatchObject({ status: 'ok', count: 1 });
    const unsaved = await app.inject({ method: 'POST', url: '/api/sources/test', payload: { name: 'Trial', kind: 'rss', config: { url: 'https://town.example/feed.xml' } } });
    expect(unsaved.statusCode).toBe(200);
    const tried = pipeline.calls.filter((c) => c.method === 'testSource').map((c) => (c.args[0] as SourceRecord).name);
    expect(tried).toEqual(['Town of Example bids', 'Trial']);

    expect((await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}` })).statusCode).toBe(404);
  });

  it('refuses to delete a built-in source and rejects bad input', async () => {
    const { app, deps } = await harness();
    const builtin = deps.store.listSources().find((s) => s.builtin)!;
    const del = await app.inject({ method: 'DELETE', url: `/api/sources/${builtin.id}` });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe('Built-in sources can be switched off but not deleted.');

    const regex = await app.inject({ method: 'POST', url: '/api/sources', payload: { name: 'Bad', kind: 'html_list', config: { url: 'https://x.example/', linkPattern: '([' } } });
    expect(regex.statusCode).toBe(400);
    expect(regex.json().error).toMatch(/not a valid regular expression/);
    const scheme = await app.inject({ method: 'POST', url: '/api/sources', payload: { name: 'Bad', kind: 'rss', config: { url: 'ftp://x.example/feed' } } });
    expect(scheme.statusCode).toBe(400);
    expect(scheme.json().error).toMatch(/http/);
    const name = await app.inject({ method: 'POST', url: '/api/sources', payload: { name: '', kind: 'rss' } });
    expect(name.statusCode).toBe(400);
    expect(name.json().error).toContain('“name”');
  });
});

describe('documents', () => {
  it('uploads, lists, downloads, edits and deletes a library document', async () => {
    const { app } = await harness();
    const form = multipart(
      { name: 'Liability certificate', kind: 'insurance', expiresOn: '2027-03-31', attachByDefault: 'true' },
      { name: '../../etc/Certificate\u0007 2026.pdf', type: 'application/pdf', content: Buffer.from('%PDF-1.4 insurance') },
    );
    const up = await app.inject({ method: 'POST', url: '/api/documents', ...form });
    expect(up.statusCode).toBe(200);
    const doc = up.json();
    expect(doc).toMatchObject({ name: 'Liability certificate', kind: 'insurance', filename: 'Certificate 2026.pdf', expiresOn: '2027-03-31', attachByDefault: true, size: 18 });

    expect((await app.inject({ method: 'GET', url: '/api/documents' })).json()).toHaveLength(1);
    const down = await app.inject({ method: 'GET', url: `/api/documents/${doc.id}/download` });
    expect(down.body).toBe('%PDF-1.4 insurance');
    expect(down.headers['content-disposition']).toMatch(/^attachment; filename="Certificate 2026\.pdf"/);
    expect(down.headers['x-content-type-options']).toBe('nosniff');

    const patched = await app.inject({ method: 'PATCH', url: `/api/documents/${doc.id}`, payload: { attachByDefault: false, expiresOn: '' } });
    expect(patched.json()).toMatchObject({ attachByDefault: false, expiresOn: '' });

    expect((await app.inject({ method: 'DELETE', url: `/api/documents/${doc.id}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: `/api/documents/${doc.id}/download` })).statusCode).toBe(404);
  });

  it('rejects uploads without a file or with a bad kind', async () => {
    const { app } = await harness();
    const none = await app.inject({ method: 'POST', url: '/api/documents', ...multipart({ name: 'x' }) });
    expect(none.statusCode).toBe(400);
    expect(none.json().error).toBe('Please choose a file to upload.');
    const kind = await app.inject({ method: 'POST', url: '/api/documents', ...multipart({ kind: 'secret' }, { name: 'a.pdf', type: 'application/pdf', content: Buffer.from('x') }) });
    expect(kind.statusCode).toBe(400);
    const json = await app.inject({ method: 'POST', url: '/api/documents', payload: { file: 'x' } });
    expect(json.statusCode).toBe(400);
  });
});

describe('applications', () => {
  let h: Harness;
  let oppId: number;
  let appId: number;

  beforeEach(async () => {
    h = await harness();
    oppId = seedOpportunity(h.deps, { title: 'Park Mowing Services' });
    appId = createApp(h.deps, oppId).id;
  });

  it('lists and reads applications with their opportunity', async () => {
    const list = await h.app.inject({ method: 'GET', url: '/api/applications?status=ready,needs_input' });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].opportunity.title).toBe('Park Mowing Services');
    expect((await h.app.inject({ method: 'GET', url: '/api/applications?status=submitted' })).json()).toHaveLength(0);
    expect((await h.app.inject({ method: 'GET', url: '/api/applications?status=bogus' })).statusCode).toBe(400);
    expect((await h.app.inject({ method: 'GET', url: `/api/applications/${appId}` })).json().opportunity.id).toBe(oppId);
    expect((await h.app.inject({ method: 'GET', url: '/api/applications/9999' })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: '/api/applications/abc' })).statusCode).toBe(404);
  });

  it('applies an edit, ticks checklist items by key and reassesses', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/applications/${appId}`,
      payload: { subject: 'Quotation for park mowing', priceTotal: 12500, checklist: [{ key: 'forms', done: true }, { key: 'unknown', done: true }] },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json() as Application;
    expect(updated).toMatchObject({ subject: 'Quotation for park mowing', priceTotal: 12500, editedByUser: true });
    expect(updated.checklist.map((c) => [c.key, c.done])).toEqual([
      ['forms', true],
      ['site_meeting', false],
    ]);
    expect(updated.checklist[0]!.label).toBe('Sign the bid form');
    expect(h.pipeline.calls.filter((c) => c.method === 'reassess').map((c) => c.args[0])).toEqual([appId]);

    const priceOnly = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { priceNotes: 'Includes GST.' } });
    expect(priceOnly.json().priceNotes).toBe('Includes GST.');
  });

  it('does not flag an edit when only the price changed', async () => {
    const res = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { priceTotal: 100, subject: 'Quotation: Park mowing' } });
    expect(res.json().editedByUser).toBe(false);
  });

  it('validates addresses and refuses edits in a closed state', async () => {
    const bad = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { toEmail: 'not-an-address' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/not a valid e-mail address/);
    const cc = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { ccEmail: 'a@town.example, b@town.example' } });
    expect(cc.statusCode).toBe(200);

    h.deps.store.transitionApplication(appId, ['ready'], 'submitted', NOW);
    const locked = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { subject: 'Changed' } });
    expect(locked.statusCode).toBe(409);
    expect((await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/regenerate` })).statusCode).toBe(409);
  });

  it('regenerates through the pipeline', async () => {
    const res = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/regenerate` });
    expect(res.statusCode).toBe(200);
    expect(h.pipeline.calls.find((c) => c.method === 'draftFor')!.args).toEqual([oppId, { rebuild: true }]);
  });

  it('maps send results to the fresh application or a 409 with the reason', async () => {
    h.pipeline.sendResult = { ok: false, error: 'Outgoing e-mail is not set up yet.' };
    const refused = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/send` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'Outgoing e-mail is not set up yet.' });

    h.pipeline.sendResult = { ok: true, error: '' };
    const sent = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/send` });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().status).toBe('submitted');
    expect(h.pipeline.calls.filter((c) => c.method === 'send').map((c) => c.args)).toEqual([
      [appId, { auto: false }],
      [appId, { auto: false }],
    ]);
  });

  it('marks a portal submission as submitted, once', async () => {
    h.deps.store.updateApplication(appId, { notes: 'Earlier note.' }, NOW);
    const res = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/mark-submitted`, payload: { ref: 'BF-12345', note: 'Uploaded to Bonfire.' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'submitted',
      submittedAt: '2026-06-15T20:00:00Z',
      submittedVia: 'portal',
      submissionRef: 'BF-12345',
      notes: 'Earlier note.\n\nUploaded to Bonfire.',
    });
    expect(h.deps.store.listEvents(10).some((e) => e.kind === 'application_submitted' && e.applicationId === appId)).toBe(true);
    expect((await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/mark-submitted`, payload: {} })).statusCode).toBe(409);
    const longVia = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/mark-submitted`, payload: { via: 'x'.repeat(81) } });
    expect(longVia.statusCode).toBe(400);
  });

  it('allows only sensible status changes', async () => {
    const post = (status: string) => h.app.inject({ method: 'POST', url: `/api/applications/${appId}/status`, payload: { status } });
    expect((await post('won')).statusCode).toBe(409);
    expect((await post('withdrawn')).json().status).toBe('withdrawn');
    expect((await post('withdrawn')).statusCode).toBe(409);

    const reopened = await post('needs_input');
    expect(reopened.json().status).toBe('needs_input');
    expect(h.pipeline.calls.some((c) => c.method === 'reassess' && c.args[0] === appId)).toBe(true);

    h.deps.store.transitionApplication(appId, ['needs_input'], 'submitted', NOW);
    expect((await post('lost')).json().status).toBe('lost');
    expect((await post('won')).statusCode).toBe(409);
    expect((await post('bogus')).statusCode).toBe(400);
  });

  it('does not reopen an application whose opportunity has closed', async () => {
    const closedOpp = seedOpportunity(h.deps, { title: 'Closed Mowing', closesAt: at(-48) });
    const closedApp = createApp(h.deps, closedOpp, 'expired');
    const res = await h.app.inject({ method: 'POST', url: `/api/applications/${closedApp.id}/status`, payload: { status: 'needs_input' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/closed/);
  });

  it('serves the package PDF inline', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/applications/${appId}/package.pdf` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="Application \d+\.pdf"/);
    expect(res.body.startsWith('%PDF')).toBe(true);
  });

  it('uploads, downloads and deletes files on an application', async () => {
    const form = multipart({}, { name: 'Signed bid form – é.pdf', type: 'application/pdf', content: Buffer.from('%PDF signed') });
    const up = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/files`, ...form });
    expect(up.statusCode).toBe(200);
    const files = (up.json() as Application).files;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: 'Signed bid form – é.pdf', size: 11 });

    const down = await h.app.inject({ method: 'GET', url: `/api/applications/${appId}/files/${files[0]!.id}` });
    expect(down.body).toBe('%PDF signed');
    expect(down.headers['content-disposition']).toBe(`attachment; filename="Signed bid form  e.pdf"; filename*=UTF-8''Signed%20bid%20form%20%E2%80%93%20%C3%A9.pdf`);

    const del = await h.app.inject({ method: 'DELETE', url: `/api/applications/${appId}/files/${files[0]!.id}` });
    expect(del.json().files).toHaveLength(0);
    expect((await h.app.inject({ method: 'GET', url: `/api/applications/${appId}/files/${files[0]!.id}` })).statusCode).toBe(404);
  });

  it('refuses files over 25 MB', async () => {
    const big = multipart({}, { name: 'huge.pdf', type: 'application/pdf', content: Buffer.alloc(25 * 1024 * 1024 + 10, 1) });
    const res = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/files`, ...big });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatch(/25 MB/);
  });
});

describe('opportunities', () => {
  it('lists by view with counts and filters by text', async () => {
    const { app, deps } = await harness();
    seedOpportunity(deps, { title: 'Boulevard Mowing' });
    seedOpportunity(deps, { title: 'Sewer Relining', decision: 'unsuitable' });
    seedOpportunity(deps, { title: 'Garden Bed Care', decision: 'review' });

    const suitable = (await app.inject({ method: 'GET', url: '/api/opportunities?view=suitable' })).json();
    expect(suitable.items.map((o: { title: string }) => o.title)).toEqual(['Boulevard Mowing']);
    expect(suitable.total).toBe(1);
    expect(suitable.counts).toMatchObject({ suitable: 1, review: 1, unsuitable: 1, all: 3 });
    expect(suitable.items[0]).not.toHaveProperty('documentText');

    const search = (await app.inject({ method: 'GET', url: '/api/opportunities?q=garden' })).json();
    expect(search.items.map((o: { title: string }) => o.title)).toEqual(['Garden Bed Care']);
    expect((await app.inject({ method: 'GET', url: '/api/opportunities?view=nope' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/opportunities/424242' })).statusCode).toBe(404);
  });

  it('pursues (drafting an application), dismisses (withdrawing it) and clears decisions', async () => {
    const { app, deps, pipeline } = await harness();
    const id = seedOpportunity(deps, { title: 'Garden Bed Care', decision: 'review' });

    const pursued = await app.inject({ method: 'POST', url: `/api/opportunities/${id}/decision`, payload: { decision: 'pursue' } });
    expect(pursued.statusCode).toBe(200);
    expect(pursued.json()).toMatchObject({ userDecision: 'pursue', analysis: { alsoListed: [] } });
    expect(pipeline.calls.find((c) => c.method === 'draftFor')!.args).toEqual([id, { rebuild: false }]);
    const application = deps.store.getApplicationByOpportunity(id)!;

    const dismissed = await app.inject({ method: 'POST', url: `/api/opportunities/${id}/decision`, payload: { decision: 'dismissed' } });
    expect(dismissed.json().userDecision).toBe('dismissed');
    expect(deps.store.getApplication(application.id)!.status).toBe('withdrawn');

    const cleared = await app.inject({ method: 'POST', url: `/api/opportunities/${id}/decision`, payload: { decision: null } });
    expect(cleared.json().userDecision).toBeNull();
    expect((await app.inject({ method: 'POST', url: `/api/opportunities/${id}/decision`, payload: { decision: 'maybe' } })).statusCode).toBe(400);
  });
});

describe('runs, events and calendar', () => {
  it('starts a run without waiting and refuses a second one', async () => {
    const { app, pipeline } = await harness();
    const started = await app.inject({ method: 'POST', url: '/api/runs' });
    expect(started.statusCode).toBe(202);
    expect(started.json().running).toBe(true);
    expect(pipeline.calls.filter((c) => c.method === 'run').map((c) => c.args[0])).toEqual(['manual']);

    pipeline.running = true;
    const again = await app.inject({ method: 'POST', url: '/api/runs' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/already running/);

    const current = (await app.inject({ method: 'GET', url: '/api/runs/current' })).json();
    expect(current).toMatchObject({ running: true, run: { trigger: 'manual' } });
    expect((await app.inject({ method: 'GET', url: '/api/runs' })).json()).toHaveLength(1);
    expect(Array.isArray((await app.inject({ method: 'GET', url: '/api/events?limit=5' })).json())).toBe(true);
  });

  it('exports closing dates as an iCalendar file', async () => {
    const { app, deps } = await harness();
    const timed = seedOpportunity(deps, { title: 'Boulevard Mowing; Trimming, and Edging of Parks in the District of Saanich — 2026 season', closesAt: '2026-06-25T21:00:00Z' });
    const dated = seedOpportunity(deps, { title: 'Hanging Baskets', closesAt: '2026-07-03T06:59:59Z', precision: 'date' });
    seedOpportunity(deps, { title: 'Open-ended', closesAt: null });
    seedOpportunity(deps, { title: 'Sewer Relining', decision: 'unsuitable' });

    const res = await app.inject({ method: 'GET', url: '/api/calendar.ics' });
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    const body = res.body;
    expect(body.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body).toContain(`UID:opportunity-${timed}@lgbids`);
    expect(body).toContain('DTSTART:20260625T210000Z');
    expect(body).toContain(`UID:opportunity-${dated}@lgbids`);
    expect(body).toContain('DTSTART;VALUE=DATE:20260702');
    expect(body).toContain('DTEND;VALUE=DATE:20260703');
    const unfolded = body.replace(/\r\n /g, '');
    expect(unfolded).toContain('SUMMARY:Bid closes: Boulevard Mowing\\; Trimming\\, and Edging');
    for (const line of body.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});

describe('dashboard', () => {
  it('summarises the state of things', async () => {
    const { app, deps } = await harness();
    const soon = seedOpportunity(deps, { title: 'Closing Soon Mowing', closesAt: at(48) });
    seedOpportunity(deps, { title: 'Later Mowing', closesAt: at(24 * 20) });
    seedOpportunity(deps, { title: 'Garden Review', decision: 'review' });
    createApp(deps, soon, 'needs_input');

    const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toMatchObject({
      mode: 'prepare',
      running: false,
      lastRun: null,
      nextRunAt: at(6),
      demo: false,
      timeZone: 'America/Vancouver',
      counts: { openSuitable: 2, review: 1, needsInput: 1, ready: 0, submitted: 0, closingSoon: 1, sourcesFailing: 0 },
    });
    expect(d.counts.sourcesEnabled).toBeGreaterThan(1);
    expect(d.attention.map((a: Application) => a.opportunityId)).toEqual([soon]);
    expect(d.deadlines.map((o: { title: string }) => o.title)).toEqual(['Closing Soon Mowing', 'Later Mowing']);
    expect(d.setup.map((s: { key: string; done: boolean }) => [s.key, s.done])).toEqual([
      ['profile', false],
      ['services', false],
      ['email', false],
      ['documents', false],
      ['run', false],
    ]);
    expect(d.sources.filter((s: { enabled: boolean }) => s.enabled).length).toBe(d.counts.sourcesEnabled);
  });
});

describe('web UI', () => {
  it('explains that the UI is not built when there is no web folder', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toContain('npm run build');
    const missing = await app.inject({ method: 'GET', url: '/api/nothing-here' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('There is nothing at this address.');
  });

  it('serves the built files and falls back to index.html for client routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lgbids-web-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Lgbids</title><div id="root"></div>');
      writeFileSync(join(dir, 'manifest.webmanifest'), '{"display":"standalone"}');
      const { app } = await harness({ webDir: dir });
      const index = await app.inject({ method: 'GET', url: '/' });
      expect(index.body).toContain('<div id="root">');
      expect((await app.inject({ method: 'GET', url: '/manifest.webmanifest' })).body).toContain('standalone');
      const route = await app.inject({ method: 'GET', url: '/opportunities/12' });
      expect(route.statusCode).toBe(200);
      expect(route.headers['content-type']).toMatch(/^text\/html/);
      expect(route.body).toContain('<div id="root">');
      const api = await app.inject({ method: 'GET', url: '/api/nope' });
      expect(api.statusCode).toBe(404);
      expect(api.headers['content-type']).toMatch(/json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
