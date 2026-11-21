// Shared set-up for the API tests: an app on an in-memory database with a fake
// pipeline and scheduler that only record what the routes asked of them.
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { createDeps } from '../../src/server/bootstrap.js';
import type { AppConfig, AppDeps, Mailer, OutgoingMail, Pipeline, Scheduler, SendResult, SourceTestResult } from '../../src/server/contracts.js';
import { sourceConfigSchema, type Analysis, type Application, type Decision, type SourceRecord } from '../../src/shared/schemas.js';

export const NOW = new Date('2026-06-15T20:00:00Z');
export const HOUR = 3_600_000;
export const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const baseConfig: AppConfig = {
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

export interface FakePipeline extends Pipeline {
  calls: { method: string; args: unknown[] }[];
  running: boolean;
  sendResult: SendResult;
}

export function fakePipeline(deps: AppDeps): FakePipeline {
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

export interface FakeScheduler extends Scheduler {
  reschedules: number;
}

export function fakeScheduler(): FakeScheduler {
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

export const SOURCE_ID = 'test-source';

export function analysis(): Analysis {
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

export function seedOpportunity(
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

export function createApp(deps: AppDeps, opportunityId: number, status: Application['status'] = 'ready'): Application {
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

export function multipart(fields: Record<string, string>, file?: { name: string; type: string; content: Buffer }) {
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

export interface Harness {
  app: FastifyInstance;
  deps: AppDeps;
  pipeline: FakePipeline;
  scheduler: FakeScheduler;
  sent: OutgoingMail[];
}

const open: Harness[] = [];

export async function harness(config: Partial<AppConfig> = {}, mailer?: Partial<Mailer>, overrides: Partial<AppDeps> = {}): Promise<Harness> {
  const sent: OutgoingMail[] = [];
  const deps = createDeps(
    { ...baseConfig, ...config },
    {
      now: () => NOW,
      ...overrides,
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


/** Closes every app and store opened by harness(); call it from afterEach. */
export async function closeHarnesses(): Promise<void> {
  for (const h of open.splice(0)) {
    await h.app.close();
    h.deps.store.close();
  }
}
