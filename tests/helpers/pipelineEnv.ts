// Shared set-up for the pipeline tests: the invented sample sites, an
// in-memory store with every sample source, and a recording mailer.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { sourceConfigSchema, type Profile, type SourceConfig, type SourceKind } from '../../src/shared/schemas.js';
import type { AppDeps, MailerFactory, OutgoingMail, Store } from '../../src/server/contracts.js';
import type { AlertMailbox } from '../../src/server/sources/alerts/mailbox.js';
import { openDatabase } from '../../src/server/db/database.js';
import { createStore } from '../../src/server/db/store.js';
import { startFixtureServer, type FixtureServer } from '../../src/server/demo/server.js';
import { createFileStore } from '../../src/server/files.js';
import { HttpClient } from '../../src/server/http/client.js';
import { createSettings } from '../../src/server/settings.js';

export const NOW = new Date('2026-06-15T20:00:00Z');
let server: FixtureServer | null = null;
export const dirs: string[] = [];

/** Starts the invented sample sites; call it from beforeAll. */
export async function startFixtures(): Promise<void> {
  server = await startFixtureServer(NOW);
}

/** Stops the sample sites and removes every data folder made by makeEnv; call it from afterAll. */
export async function stopFixtures(): Promise<void> {
  await server?.close();
  server = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Base URL of the running sample sites. */
export function fixtureUrl(): string {
  if (!server) throw new Error('The sample sites are not running: call startFixtures() in beforeAll.');
  return server.url;
}

export function sources(): { id: string; name: string; kind: SourceKind; config: Partial<SourceConfig> }[] {
  const u = fixtureUrl();
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

export const PROFILE: Partial<Profile> = {
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

export const SMTP = { host: 'smtp.garryoak.example', port: 587, secure: false, user: 'office@garryoak.example', pass: 'secret', fromName: 'Garry Oak Grounds', fromEmail: 'office@garryoak.example' };

export interface Env {
  deps: AppDeps;
  store: Store;
  sent: OutgoingMail[];
  clock: { now: Date };
  mailFails: { value: boolean };
}

export function makeEnv(opts: { profile?: boolean; smtp?: boolean; automation?: Record<string, unknown>; extraSources?: ReturnType<typeof sources>; noSamples?: boolean; mailbox?: AlertMailbox } = {}): Env {
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
  for (const s of [...(opts.noSamples ? [] : sources()), ...(opts.extraSources ?? [])]) {
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
    alertMailboxFactory: () => {
      if (!opts.mailbox) throw new Error('No test mailbox.');
      return opts.mailbox;
    },
    alertImportDir: join(dir, 'alert-inbox'),
    now: () => clock.now,
  };
  return { deps, store, sent, clock, mailFails };
}

export const find = (env: Env, fragment: string) => {
  const items = env.store.listOpportunities({ view: 'all', q: fragment, limit: 50 }, env.clock.now).items;
  expect(items, fragment).toHaveLength(1);
  return items[0]!;
};

export const appFor = (env: Env, fragment: string) => {
  const app = env.store.getApplicationByOpportunity(find(env, fragment).id);
  expect(app, fragment).toBeDefined();
  return app!;
};

/** What a person does on the application page: tick checklist items (and enter a price). */
export function tick(env: Env, fragment: string, keys: string[], priceTotal?: number) {
  const app = appFor(env, fragment);
  env.store.updateApplication(
    app.id,
    { checklist: app.checklist.map((c) => (keys.includes(c.key) ? { ...c, done: true } : c)), ...(priceTotal !== undefined ? { priceTotal } : {}) },
    env.clock.now,
  );
  return app.id;
}

export const sentTo = (env: Env) => env.sent.flatMap((m) => m.to);
