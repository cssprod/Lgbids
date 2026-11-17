import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { createDeps, startServer } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import type { AppConfig } from '../contracts.js';
import { startFixtureServer } from '../demo/server.js';
import { sourceConfigSchema, type Profile, type SourceConfig, type SourceKind } from '../../shared/schemas.js';

/**
 * `npm run demo`: try the whole app with invented data and nothing leaving
 * this computer. The sample bid sites are served locally, outgoing mail goes
 * to a local sink that only counts it, and everything lives in ./data-demo,
 * which is wiped at every start.
 */

const BANNER = [
  '==================================================================',
  '  DEMO MODE: every bid site, notice, company and e-mail shown is',
  '  invented. Nothing is fetched from real sites and no mail leaves',
  '  this computer.',
  '==================================================================',
];

interface MailSink {
  port: number;
  count(): number;
  close(): Promise<void>;
}

function decodeSubject(raw: string): string {
  // Encoded words (=?UTF-8?B?...?= / =?UTF-8?Q?...?=) as nodemailer writes them.
  return raw.replace(/=\?utf-8\?([bq])\?([^?]*)\?=\s*/gi, (_m, enc: string, text: string) =>
    enc.toLowerCase() === 'b'
      ? Buffer.from(text, 'base64').toString('utf8')
      : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'),
  );
}

function subjectOf(message: string): string {
  const head = message.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  const line = /^subject:\s*(.*)$/im.exec(unfolded);
  return line ? decodeSubject(line[1]!.trim()) : '(no subject)';
}

/** A local SMTP server that accepts any message, prints one line about it, and keeps nothing. */
async function startMailSink(): Promise<MailSink> {
  let mod: typeof import('smtp-server');
  try {
    mod = await import('smtp-server');
  } catch {
    throw new Error('Demo mode needs the "smtp-server" package for its local mail sink. Run `npm install` (with dev dependencies) and try again.');
  }
  let captured = 0;
  const server = new mod.SMTPServer({
    authOptional: true,
    // No TLS on a loopback-only sink, so the app's mailer connects without certificate trouble.
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, callback) {
      callback(null, { user: auth.username ?? 'demo' });
    },
    onData(stream: Readable, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        captured += 1;
        const recipients = session.envelope.rcptTo.map((r) => r.address).join(', ');
        console.log(`Demo mail captured: ${subjectOf(Buffer.concat(chunks).toString('utf8'))} → ${recipients}`);
        callback();
      });
    },
  });
  await new Promise<void>((done, fail) => {
    server.server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done());
  });
  const port = (server.server.address() as AddressInfo).port;
  return {
    port,
    count: () => captured,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function demoSource(id: string, name: string, kind: SourceKind, notes: string, config: Partial<SourceConfig>) {
  return { id, name: `${name} (demo)`, kind, notes, config: sourceConfigSchema.parse(config) };
}

/** The same sample sites the connector tests read, one source each. */
function demoSources(base: string) {
  const note = 'An invented sample site served by demo mode.';
  return [
    // Same id as the real alert source, so the inbox settings and import work as they do outside the demo.
    demoSource(
      'email-alerts',
      'Bid alert e-mails',
      'email_alerts',
      'Reads BC Bid and Bonfire alert e-mails. In the demo there is no inbox: one invented alert e-mail is placed in the import folder, and you can drop more .eml files here.',
      { fetchDetails: false, bcOnly: true },
    ),
    demoSource('demo-canadabuys-federal', 'Government of Canada tenders', 'canadabuys_csv', note, { url: `${base}/canadabuys/opendata/open.csv` }),
    demoSource('demo-canadabuys-bcbid', 'BC Bid notices via CanadaBuys', 'canadabuys_search', note, {
      url: `${base}/canadabuys/en/tender-opportunities?search_filter={query}&words={query}`,
      queries: ['landscape', 'mowing', 'grounds', 'turf', 'parks'],
      bcOnly: true,
      timeZone: 'America/Toronto',
    }),
    demoSource('demo-bonfire-saanich', 'District of Saanich (Bonfire)', 'bonfire', note, {
      url: `${base}/bonfire/saanich`,
      organization: 'District of Saanich',
      localBuyer: true,
      defaultSubmission: 'bonfire',
    }),
    demoSource('demo-bonfire-victoria', 'City of Victoria (Bonfire)', 'bonfire', note, {
      url: `${base}/bonfire/victoria`,
      organization: 'City of Victoria',
      localBuyer: true,
      defaultSubmission: 'bonfire',
    }),
    demoSource('demo-saanich-rss', 'District of Saanich news feed', 'rss', note, {
      url: `${base}/saanich/tenders.rss`,
      organization: 'District of Saanich',
      localBuyer: true,
      defaultSubmission: 'bonfire',
    }),
    demoSource('demo-crd', 'Capital Regional District', 'html_list', note, {
      url: `${base}/crd/contracts-rfps/current`,
      linkPattern: '^/crd/contracts-rfps/current/[^/?#]+',
      organization: 'Capital Regional District',
      localBuyer: true,
    }),
    demoSource('demo-esquimalt', 'Township of Esquimalt', 'html_list', note, {
      url: `${base}/esquimalt/business-development/bids-tenders`,
      linkPattern: '^/esquimalt/business-development/bids-tenders/[^/?#]+',
      organization: 'Township of Esquimalt',
      localBuyer: true,
    }),
    demoSource('demo-civicinfo', 'CivicInfo BC bids', 'html_list', note, {
      url: `${base}/civicinfo/bids`,
      pageParam: 'pn',
      pageStart: 1,
      maxPages: 5,
      bcOnly: true,
    }),
  ];
}

/** A clearly fictional company, so the drafts have something to say. */
const DEMO_PROFILE: Partial<Profile> = {
  legalName: 'Garry Oak Gardens Ltd.',
  tradeName: 'Garry Oak Gardens',
  addressLine: '100 Example Road',
  city: 'Victoria',
  province: 'BC',
  postalCode: 'V8V 0A0',
  phone: '250-555-0100',
  email: 'bids@garryoakgardens.example',
  website: 'https://garryoakgardens.example',
  contactName: 'Sam Example',
  contactTitle: 'Operations Manager',
  signatoryName: 'Sam Example',
  signatoryTitle: 'President',
  gstNumber: '000000000 RT0001',
  worksafeNumber: '000000-AA',
  businessLicence: 'Inter-municipal business licence (demo)',
  yearEstablished: 2012,
  crewSize: 9,
  insuranceProvider: 'Example Mutual Insurance',
  insurancePolicy: 'DEMO-0001',
  insuranceLiability: 5_000_000,
  insuranceExpiry: '2027-03-31',
  bondingAvailable: false,
  about: 'Garry Oak Gardens is an invented landscape maintenance company used to demonstrate this app.',
  approach: 'Crews work to a written seasonal plan agreed with the client, with a site lead who reports after every visit.',
  safety: 'All crew members hold first aid tickets and follow a written safety program reviewed every spring.',
  references: [
    { client: 'Example Strata Corporation', contactName: 'Pat Sample', contactInfo: 'pat@strata.example', description: 'Weekly grounds maintenance for a 120-unit strata.', year: '2023–2026', value: '$48,000 / year' },
    { client: 'Example Community Association', contactName: 'Lee Placeholder', contactInfo: 'lee@community.example', description: 'Garden bed renovation and seasonal planting.', year: '2025', value: '$22,500' },
    { client: 'Example School Society', contactName: 'Chris Demo', contactInfo: 'chris@school.example', description: 'Turf care and playing field mowing.', year: '2022–2025', value: '$31,000 / year' },
  ],
  rates: [
    { label: 'Landscape labourer', unit: 'hour', rate: 62 },
    { label: 'Crew lead', unit: 'hour', rate: 78 },
    { label: 'Ride-on mower with operator', unit: 'hour', rate: 115 },
  ],
};

const DEMO_ALERT_EML = [
  'From: BC Bid (demo) <noreply@bcbid.gov.bc.ca>',
  'To: bids@garryoakgardens.example',
  'Subject: BC Bid: new opportunity matching your commodities (invented demo alert)',
  'Date: Mon, 16 Nov 2026 08:00:00 -0700',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>An invented alert for demo mode.</p><table><tr><th>Opportunity ID</th><th>Description</th><th>Organization</th><th>Closing Date</th></tr>',
  `<tr><td>DEMO-26-301</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/0">Park and Trail Mowing Services (demo)</a></td><td>Town of View Royal</td><td>${new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)} 2:00 PM</td></tr></table>`,
].join('\r\n');

async function main(): Promise<void> {
  for (const line of BANNER) console.log(line);

  const dataDir = resolve(process.env.DEMO_DATA_DIR || './data-demo');
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  // SMTP_* variables would point the demo's mail at a real server; the sink replaces them.
  for (const key of Object.keys(process.env)) if (key.startsWith('SMTP_')) delete process.env[key];

  const fixtures = await startFixtureServer(new Date());
  const sink = await startMailSink();

  const config: AppConfig = { ...loadConfig(process.env), dataDir, demo: true };
  const deps = createDeps(config);
  const now = deps.now();
  deps.store.seedSources(demoSources(fixtures.url), now);
  // An invented BC Bid alert for the "Bid alert e-mails" source to read on the first check.
  mkdirSync(deps.alertImportDir, { recursive: true });
  writeFileSync(join(deps.alertImportDir, 'demo-bcbid-alert.eml'), DEMO_ALERT_EML);
  deps.settings.setProfile(DEMO_PROFILE);
  deps.settings.setEmail({
    host: '127.0.0.1',
    port: sink.port,
    secure: false,
    user: 'demo',
    pass: 'demo',
    fromName: 'Garry Oak Gardens Ltd.',
    fromEmail: 'bids@garryoakgardens.example',
    replyTo: '',
    bccSelf: true,
  });
  // The sample sites are local, so the polite delay between requests can be short.
  deps.settings.setAutomation({ ...deps.settings.getAutomation(), mode: 'prepare', requestDelayMs: 250 });

  const server = await startServer(config, deps);
  console.log(`\nDemo sample sites: ${fixtures.url}`);
  console.log(`Demo mail sink:    127.0.0.1:${sink.port} (mail is counted and dropped)`);
  console.log(`\nOpen ${server.url} to try Lgbids with the invented data.\n`);

  if (!server.pipeline.isRunning()) {
    server.pipeline.run('startup').then(
      (run) => console.log(`First demo run finished: ${run.status}. ${run.stats ? `${run.stats.found} notices read, ${run.stats.suitable} suitable, ${run.stats.drafted} drafted.` : ''}`),
      (err: unknown) => console.error('The first demo run failed:', err instanceof Error ? err.message : err),
    );
  }

  const shutdown = () => {
    console.log(`\nStopping the demo (${sink.count()} demo e-mails were captured).`);
    Promise.allSettled([server.stop(), fixtures.close(), sink.close()]).then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
