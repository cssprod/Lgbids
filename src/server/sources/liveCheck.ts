import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RegionSettings, SourceRecord } from '../../shared/schemas.js';
import { BUYERS } from '../../shared/buyers.js';
import { openDatabase } from '../db/database.js';
import { createStore } from '../db/store.js';
import { HttpClient, HttpError, USER_AGENT } from '../http/client.js';
import { isAllowed, parseRobots } from '../http/robots.js';
import { scrubEml, scrubHtml } from '../util/scrub.js';
import type { AlertMailbox } from './alerts/mailbox.js';
import { ALERT_FROM_SEARCHES, alertSender } from './alerts/parse.js';
import { readAlertMessage } from './connectors/emailAlerts.js';
import { extractListing } from './extract.js';
import { connectorFor, listSource, type DefaultSource } from './registry.js';
import type { ConnectorContext, RawOpportunity } from './types.js';

/**
 * The live-check kit (`npm run live-check`). The development sandbox cannot
 * reach the bid sites or a mailbox, so the user runs this on their own
 * computer and sends back the report: every reader fix needs real evidence.
 *
 * It saves nothing in the app's database (the sources live in an in-memory
 * store), sends every request through `HttpClient` (robots.txt and the
 * private-address rules apply), reads the inbox read-only, and scrubs every
 * page and e-mail before it goes into the bundle.
 */

export const REPORT_MAX_BYTES = 20 * 1024;
export const BUNDLE_MAX_BYTES = 5 * 1024 * 1024;
const SAMPLES = 5;
const NOTICE_PAGES = 2;
const EML_PER_SENDER = 3;
const MAX_MESSAGES = 200;
const MAX_EML_BYTES = 5 * 1024 * 1024;
/** Text pages kept by the recorder, so `--save-html` needs no second request. */
const RECORD_MAX_CHARS = 2_000_000;

/** Bid portals whose robots.txt the kit reads. `robotsOnly`: never one GET (CivicInfo puts a bot check in front). */
export const PORTAL_PROBES: { name: string; url: string; robotsOnly?: boolean }[] = [
  { name: 'bids&tenders', url: 'https://bidsandtenders.ca/' },
  { name: 'MERX', url: 'https://www.merx.com/' },
  { name: 'Biddingo', url: 'https://www.biddingo.com/' },
  { name: 'CivicInfo BC', url: 'https://www.civicinfo.bc.ca/', robotsOnly: true },
];

/** The unconfirmed buyer pages in `shared/buyers.ts` that only the kit probes. */
export function candidateProbes(): { buyer: string; url: string }[] {
  return BUYERS.flatMap((b) => b.candidateUrls.map((url) => ({ buyer: b.name, url })));
}

// ---------------------------------------------------------------------------
// HTTP: one robots.txt request per site, and pages kept for --save-html
// ---------------------------------------------------------------------------

export interface PageRecorder {
  /** Text of an HTML/XML response by the URL it was fetched from. */
  page(url: string): Promise<string | undefined>;
}

/**
 * Wraps `fetch` so a robots.txt is fetched from the network once per run (the
 * client's own robots check and the kit's verdict share it), and HTML/XML
 * pages are remembered for the scrubbed copies. Requests still go through
 * `HttpClient`, which this only feeds.
 */
export function createLiveCheckHttp(opts: { allowPrivate: boolean; delayMs?: number; fetchImpl?: typeof fetch }): { http: HttpClient; recorder: PageRecorder } {
  const base = opts.fetchImpl ?? fetch;
  const robots = new Map<string, Promise<{ status: number; headers: [string, string][]; text: string }>>();
  const pages = new Map<string, Promise<string | undefined>>();
  const replay = (r: { status: number; headers: [string, string][]; text: string }) =>
    new Response([101, 204, 205, 304].includes(r.status) || r.text === '' ? null : r.text, { status: r.status, headers: r.headers });

  const wrapped = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).pathname === '/robots.txt') {
      let pending = robots.get(url);
      if (!pending) {
        pending = base(input, init).then(async (res) => ({ status: res.status, headers: [...res.headers.entries()], text: await res.text() }));
        robots.set(url, pending);
        // A failed request is not remembered, so the client's error handling sees it again.
        pending.catch(() => robots.delete(url));
      }
      return replay(await pending);
    }
    const res = await base(input, init);
    if (/html|xml/i.test(res.headers.get('content-type') ?? '') && res.ok) {
      pages.set(
        url,
        res
          .clone()
          .text()
          .then((text) => text.slice(0, RECORD_MAX_CHARS))
          .catch(() => undefined),
      );
    }
    return res;
  }) as typeof fetch;

  const http = new HttpClient({ delayMs: opts.delayMs ?? 1500, retries: 1, allowPrivate: opts.allowPrivate, fetchImpl: wrapped });
  return { http, recorder: { page: async (url) => pages.get(url) } };
}

/** Built-in sources as records in an in-memory store, never the user's database. */
export function recordsFrom(defs: DefaultSource[], now: Date): { record: SourceRecord; blocked: boolean }[] {
  const store = createStore(openDatabase(':memory:'));
  try {
    for (const d of defs) store.insertSource({ id: d.id, name: d.name, kind: d.kind, enabled: d.enabled !== false, builtin: true, notes: d.notes, config: d.config }, now);
    const byId = new Map(store.listSources().map((r) => [r.id, r]));
    return defs.flatMap((d) => (byId.has(d.id) ? [{ record: byId.get(d.id)!, blocked: d.forceOff === true }] : []));
  } finally {
    store.close();
  }
}

// ---------------------------------------------------------------------------
// Report data
// ---------------------------------------------------------------------------

export type RobotsVerdict = 'allowed' | 'disallowed' | 'no robots.txt' | 'unreadable' | 'not checked';

export interface NoticeSample {
  title: string;
  url: string;
  closing: string | null;
  reference: string;
}

export interface NoticePageCheck {
  url: string;
  closingFound: boolean;
  documents: number;
  error?: string;
}

export interface SourceCheck {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  blocked: boolean;
  /** Why the source was not read, when it was not. */
  skipped?: string;
  url: string;
  status: string;
  message: string;
  httpStatus: number | null;
  finalUrl: string;
  hostChanged: boolean;
  robots: RobotsVerdict;
  bytes: number;
  botCheck: boolean;
  notices: number;
  samples: NoticeSample[];
  pctClosing: number;
  pctReference: number;
  noticePages: NoticePageCheck[];
  rejected: { reason: string; count: number; examples: string[] }[];
  portals: string[];
}

export interface ProbeCheck {
  label: string;
  url: string;
  robots: RobotsVerdict;
  fetched: boolean;
  httpStatus: number | null;
  finalUrl: string;
  hostChanged: boolean;
  bytes: number;
  botCheck: boolean;
  title: string;
  portals: string[];
  message: string;
}

export interface AlertCheck {
  id: string;
  from: string;
  subject: string;
  sender: string;
  notices: number;
  /** Notices read from the scrubbed copy: differs from `notices` when scrubbing broke the e-mail. */
  noticesAfterScrub: number;
  titles: string[];
}

export interface AlertsReport {
  where: string[];
  messages: number;
  termCounts: Record<string, number>;
  bySender: Record<string, number>;
  emails: AlertCheck[];
  errors: string[];
}

export interface BundleFile {
  /** `live/<source id>/<name>.html` or `alerts/<name>.eml`. */
  path: string;
  content: string;
}

export interface LiveCheckBundle {
  version: 1;
  createdAt: string;
  userAgent: string;
  sources: SourceCheck[];
  candidates: ProbeCheck[];
  portals: ProbeCheck[];
  alerts: AlertsReport | null;
  files: BundleFile[];
  /** Files left out because the bundle reached its size limit. */
  omitted: string[];
}

export interface LiveCheckOptions {
  http: HttpClient;
  recorder?: PageRecorder;
  now: Date;
  region: RegionSettings;
  sources: { record: SourceRecord; blocked: boolean }[];
  candidates?: { buyer: string; url: string }[];
  portals?: { name: string; url: string; robotsOnly?: boolean }[];
  includeBlocked?: boolean;
  saveHtml?: boolean;
  /** Read-only inbox (`--alerts`). */
  mailbox?: AlertMailbox | null;
  lookbackDays?: number;
  /** Folder of saved .eml files (`--eml`). */
  emlDir?: string;
  progress?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function robotsVerdict(http: HttpClient, url: string): Promise<RobotsVerdict> {
  const target = new URL(url);
  try {
    const res = await http.get(`${target.origin}/robots.txt`, { accept: 'text/plain' });
    if (/<html/i.test(res.text.slice(0, 500))) return 'no robots.txt';
    return isAllowed(parseRobots(res.text), USER_AGENT, `${target.pathname}${target.search}`) ? 'allowed' : 'disallowed';
  } catch (error) {
    if (error instanceof HttpError && error.status !== null && error.status >= 400 && error.status < 500) return 'no robots.txt';
    return 'unreadable';
  }
}

/** Status, final address and bytes of the requests logged since `from`, following the redirects from `url`. */
function chain(http: HttpClient, from: number, url: string): { httpStatus: number | null; finalUrl: string; bytes: number } {
  const entries = http.log.slice(from).filter((e) => !/\/robots\.txt$/.test(new URL(e.url).pathname));
  let current = url;
  let httpStatus: number | null = null;
  for (const e of entries) {
    if (e.url !== current) continue;
    if (e.redirectTo) {
      current = e.redirectTo;
      continue;
    }
    if (e.status !== null && e.error !== 'retrying') {
      httpStatus = e.status;
      break;
    }
  }
  return { httpStatus, finalUrl: current, bytes: entries.reduce((n, e) => n + e.bytes, 0) };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function fileId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

function emptySource(record: SourceRecord, blocked: boolean): SourceCheck {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    enabled: record.enabled,
    blocked,
    url: record.config.url,
    status: 'skipped',
    message: '',
    httpStatus: null,
    finalUrl: record.config.url,
    hostChanged: false,
    robots: 'not checked',
    bytes: 0,
    botCheck: false,
    notices: 0,
    samples: [],
    pctClosing: 0,
    pctReference: 0,
    noticePages: [],
    rejected: [],
    portals: [],
  };
}

async function checkSource(opts: LiveCheckOptions, record: SourceRecord, blocked: boolean, files: BundleFile[]): Promise<SourceCheck> {
  const out = emptySource(record, blocked);
  const { http, recorder } = opts;
  if (record.kind === 'email_alerts') return { ...out, skipped: 'Read with --alerts or --eml (see Alerts).' };
  if (record.kind === 'manual') return { ...out, skipped: 'Bids added by hand; nothing to read.' };
  if (!record.config.url) return { ...out, skipped: 'No address is set.' };

  if (blocked && !opts.includeBlocked) return { ...out, skipped: 'Blocked source: pass --include-blocked to read its robots.txt.' };
  out.robots = await robotsVerdict(http, record.config.url);
  if (blocked) return { ...out, skipped: 'Blocked source: only its robots.txt was read.' };

  const ctx: ConnectorContext = { http, now: opts.now, region: opts.region, state: {}, note: () => undefined };
  const start = http.log.length;
  const outcome = await listSource(record, ctx);
  const c = chain(http, start, record.config.url);
  out.status = outcome.status;
  out.message = outcome.message;
  out.httpStatus = c.httpStatus;
  out.finalUrl = c.finalUrl;
  out.hostChanged = hostOf(c.finalUrl) !== hostOf(record.config.url);
  out.bytes = c.bytes;
  out.botCheck = outcome.status === 'blocked' && /bot check/i.test(outcome.message);
  const items = outcome.items;
  out.notices = items.length;
  out.samples = items.slice(0, SAMPLES).map((i) => ({ title: i.title, url: i.url, closing: i.closing?.iso ?? null, reference: i.referenceNumber ?? '' }));
  out.pctClosing = pct(items.filter((i) => i.closing).length, items.length);
  out.pctReference = pct(items.filter((i) => i.referenceNumber).length, items.length);

  const listingHtml = await recorder?.page(c.finalUrl);
  if (listingHtml && record.kind === 'html_list') {
    const explained = extractListing(listingHtml, c.finalUrl, {
      explain: true,
      linkPattern: record.config.linkPattern,
      itemSelector: record.config.itemSelector,
      organization: record.config.organization,
      zone: record.config.timeZone,
      now: opts.now,
    });
    const reasons = new Map<string, { count: number; examples: string[] }>();
    for (const r of explained.rejected) {
      const entry = reasons.get(r.reason) ?? { count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 3) entry.examples.push(r.url);
      reasons.set(r.reason, entry);
    }
    out.rejected = [...reasons].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.count - a.count);
    out.portals = explained.portals.map((p) => `${p.name} (${p.host})`);
  }
  if (listingHtml && opts.saveHtml) files.push({ path: `live/${fileId(record.id)}/listing.html`, content: scrubHtml(listingHtml) });

  const connector = connectorFor(record.kind);
  if (connector.detail) {
    const withUrl = items.filter((i): i is RawOpportunity & { url: string } => Boolean(i.url)).slice(0, NOTICE_PAGES);
    for (const [n, item] of withUrl.entries()) {
      const before = http.log.length;
      try {
        const detail = await connector.detail(record, item, ctx);
        out.noticePages.push({ url: item.url, closingFound: Boolean(detail?.closing ?? item.closing), documents: detail?.documents?.length ?? 0 });
      } catch (error) {
        out.noticePages.push({ url: item.url, closingFound: false, documents: 0, error: error instanceof Error ? error.message : String(error) });
      }
      const page = await recorder?.page(chain(http, before, item.url).finalUrl);
      if (page && opts.saveHtml) files.push({ path: `live/${fileId(record.id)}/notice-${n + 1}.html`, content: scrubHtml(page) });
    }
  }
  return out;
}

async function probe(opts: LiveCheckOptions, label: string, url: string, robotsOnly: boolean, files: BundleFile[], dir: string): Promise<ProbeCheck> {
  const { http, recorder } = opts;
  const out: ProbeCheck = { label, url, robots: 'not checked', fetched: false, httpStatus: null, finalUrl: url, hostChanged: false, bytes: 0, botCheck: false, title: '', portals: [], message: '' };
  out.robots = await robotsVerdict(http, url);
  if (robotsOnly) return { ...out, message: 'Only robots.txt is read for this site.' };
  // Robots first; one GET only when the site allows it.
  if (out.robots === 'disallowed' || out.robots === 'unreadable') return { ...out, message: 'Not read: robots.txt does not allow it.' };
  const start = http.log.length;
  try {
    const res = await http.get(url);
    out.fetched = true;
    out.httpStatus = res.status;
    out.finalUrl = res.url;
    if (/html/i.test(res.contentType)) {
      out.title = (/<title[^>]*>([^<]*)<\/title>/i.exec(res.text)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      out.portals = extractListing(res.text, res.url, { explain: true, now: opts.now }).portals.map((p) => `${p.name} (${p.host})`);
      const page = (await recorder?.page(res.url)) ?? res.text;
      if (opts.saveHtml) files.push({ path: `live/${dir}/page.html`, content: scrubHtml(page) });
    }
    out.message = 'Read.';
  } catch (error) {
    const c = chain(http, start, url);
    out.httpStatus = error instanceof HttpError ? error.status : c.httpStatus;
    out.finalUrl = c.finalUrl;
    out.botCheck = error instanceof HttpError && /bot check/i.test(error.message);
    out.message = error instanceof Error ? error.message : String(error);
  }
  out.bytes = chain(http, start, url).bytes;
  out.hostChanged = hostOf(out.finalUrl) !== hostOf(url);
  return out;
}

async function emlFiles(dir: string): Promise<{ id: string; raw: Buffer }[]> {
  const names = (await readdir(dir)).filter((n) => /\.eml$/i.test(n)).sort().slice(0, MAX_MESSAGES);
  const out: { id: string; raw: Buffer }[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && info.size <= MAX_EML_BYTES) out.push({ id: name, raw: await readFile(path) });
  }
  return out;
}

async function checkAlerts(opts: LiveCheckOptions, files: BundleFile[]): Promise<AlertsReport> {
  const report: AlertsReport = { where: [], messages: 0, termCounts: Object.fromEntries(ALERT_FROM_SEARCHES.map((t) => [t, 0])), bySender: {}, emails: [], errors: [] };
  const messages: { id: string; raw: Buffer }[] = [];
  if (opts.mailbox) {
    report.where.push('inbox (read-only)');
    try {
      const got = await opts.mailbox.fetchNew(null, { now: opts.now, lookbackDays: opts.lookbackDays ?? 30, max: MAX_MESSAGES });
      messages.push(...got.messages);
    } catch (error) {
      report.errors.push(`The inbox could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (opts.emlDir) {
    report.where.push('saved .eml files');
    try {
      messages.push(...(await emlFiles(opts.emlDir)));
    } catch (error) {
      report.errors.push(`The .eml folder could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  report.messages = messages.length;
  const kept = new Map<string, number>();
  for (const message of messages) {
    const read = await readAlertMessage(message.raw, opts.now);
    const scrubbed = scrubEml(message.raw.toString('utf8'));
    const shown = await readAlertMessage(Buffer.from(scrubbed, 'utf8'), opts.now);
    const from = read?.from ?? '';
    // The mail server searches the From line for each term; count what each term finds.
    for (const term of ALERT_FROM_SEARCHES) if (from.toLowerCase().includes(term)) report.termCounts[term] = (report.termCounts[term] ?? 0) + 1;
    const sender = alertSender(from) ?? 'unknown';
    report.bySender[sender] = (report.bySender[sender] ?? 0) + 1;
    report.emails.push({
      id: message.id,
      from: shown?.from ?? '',
      subject: shown?.subject ?? '',
      sender,
      notices: read?.items.length ?? 0,
      noticesAfterScrub: shown?.items.length ?? 0,
      titles: (shown?.items ?? []).slice(0, 3).map((i) => i.title),
    });
    const n = kept.get(sender) ?? 0;
    if (n < EML_PER_SENDER) {
      kept.set(sender, n + 1);
      files.push({ path: `alerts/${sender}-${n + 1}.eml`, content: scrubbed });
    }
  }
  return report;
}

/**
 * The bundle leaves the user's computer, so no address outside `.example`
 * may stay in it: sender addresses keep their domain, with `.example` added.
 */
export function finalScrub(text: string): string {
  return text.replace(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8})/g, (whole, host: string) =>
    /\.example$/i.test(host) ? whole : `name@${host.toLowerCase()}.example`,
  );
}

/** Run every check; returns the bundle (scrubbed, within its size limit) and the report text. */
export async function runLiveCheck(opts: LiveCheckOptions): Promise<{ bundle: LiveCheckBundle; report: string }> {
  const files: BundleFile[] = [];
  const say = opts.progress ?? (() => undefined);
  const sources: SourceCheck[] = [];
  for (const { record, blocked } of opts.sources) {
    say(`Checking ${record.name}…`);
    sources.push(await checkSource(opts, record, blocked, files));
  }
  const candidates: ProbeCheck[] = [];
  for (const [i, c] of (opts.candidates ?? []).entries()) {
    say(`Probing ${c.url}…`);
    candidates.push(await probe(opts, c.buyer, c.url, false, files, `candidate-${i + 1}-${fileId(hostOf(c.url))}`));
  }
  const portals: ProbeCheck[] = [];
  for (const [i, p] of (opts.portals ?? []).entries()) {
    say(`Reading ${p.name} robots.txt…`);
    portals.push(await probe(opts, p.name, p.url, p.robotsOnly === true, files, `portal-${i + 1}-${fileId(p.name)}`));
  }
  const alerts = opts.mailbox || opts.emlDir ? await checkAlerts(opts, files) : null;

  const bundle: LiveCheckBundle = { version: 1, createdAt: opts.now.toISOString(), userAgent: USER_AGENT, sources, candidates, portals, alerts, files: [], omitted: [] };
  let size = Buffer.byteLength(finalScrub(JSON.stringify(bundle)));
  for (const f of files) {
    const file = { path: f.path, content: finalScrub(f.content) };
    const add = Buffer.byteLength(JSON.stringify(file)) + 1;
    if (size + add > BUNDLE_MAX_BYTES) bundle.omitted.push(f.path);
    else {
      bundle.files.push(file);
      size += add;
    }
  }
  const clean = JSON.parse(finalScrub(JSON.stringify(bundle))) as LiveCheckBundle;
  return { bundle: clean, report: renderReport(clean) };
}

// ---------------------------------------------------------------------------
// report.md
// ---------------------------------------------------------------------------

const PRIVACY =
  '> Privacy: this report and bundle.json were scrubbed on your computer. E-mail addresses outside `.example`, phone numbers, tracking tokens and mail routing headers were replaced or removed. Nothing was sent anywhere; read both files before you share them.';

function md(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function sourceSection(s: SourceCheck): string[] {
  const lines = [`### ${md(s.name)} (\`${s.id}\`)`, ''];
  lines.push(`- Kind: ${s.kind}; ${s.enabled ? 'on' : 'off'} by default${s.blocked ? '; blocked' : ''}`);
  lines.push(`- Address: ${s.url || '(none)'}`);
  lines.push(`- Robots: ${s.robots}`);
  if (s.skipped) {
    lines.push(`- Not read: ${s.skipped}`, '');
    return lines;
  }
  lines.push(`- Status: ${s.status}${s.httpStatus !== null ? ` (HTTP ${s.httpStatus})` : ''}${s.message ? ` — ${md(s.message)}` : ''}`);
  lines.push(`- Final address: ${s.finalUrl}${s.hostChanged ? ' (host changed)' : ''}`);
  lines.push(`- Bytes: ${s.bytes}; bot check: ${s.botCheck ? 'yes' : 'no'}`);
  lines.push(`- Notices: ${s.notices}; with a closing date: ${s.pctClosing}%; with a reference: ${s.pctReference}%`);
  for (const x of s.samples) lines.push(`  - ${md(x.title)}${x.closing ? ` (closes ${x.closing})` : ''}${x.reference ? ` [${md(x.reference)}]` : ''}`);
  for (const p of s.noticePages) lines.push(`- Notice page ${p.url}: closing date ${p.closingFound ? 'found' : 'not found'}, ${p.documents} documents${p.error ? ` — ${md(p.error)}` : ''}`);
  if (s.rejected.length) {
    lines.push('- Links not taken:');
    for (const r of s.rejected.slice(0, 8)) lines.push(`  - ${md(r.reason)}: ${r.count}${r.examples.length ? ` (e.g. ${r.examples.slice(0, 2).join(', ')})` : ''}`);
  }
  if (s.portals.length) lines.push(`- Portal links seen: ${s.portals.join(', ')}`);
  lines.push('');
  return lines;
}

function probeTable(rows: ProbeCheck[]): string[] {
  if (rows.length === 0) return ['(none)', ''];
  const lines = ['| For | Address | Robots | Read | HTTP | Final address | Title | Portals | Note |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    lines.push(
      `| ${md(r.label)} | ${r.url} | ${r.robots} | ${r.fetched ? 'yes' : 'no'} | ${r.httpStatus ?? ''} | ${r.finalUrl}${r.hostChanged ? ' (host changed)' : ''} | ${md(r.title)} | ${md(r.portals.join(', '))} | ${md(r.botCheck ? `bot check. ${r.message}` : r.message)} |`,
    );
  }
  lines.push('');
  return lines;
}

export function renderReport(b: LiveCheckBundle): string {
  const read = b.sources.filter((s) => !s.skipped);
  const lines: string[] = [`# Lgbids live check — ${b.createdAt.slice(0, 10)}`, '', PRIVACY, ''];
  lines.push('## Summary', '');
  lines.push(`- Run as ${b.userAgent} at ${b.createdAt}.`);
  lines.push(`- Sources read: ${read.length} of ${b.sources.length}; with notices: ${read.filter((s) => s.notices > 0).length}; failed or blocked: ${read.filter((s) => s.status === 'error' || s.status === 'blocked').length}.`);
  lines.push(`- Candidate pages: ${b.candidates.length}; portal robots.txt read: ${b.portals.length}.`);
  lines.push(`- Alert e-mails: ${b.alerts ? b.alerts.messages : 'not checked (use --alerts or --eml <dir>)'}.`);
  lines.push(`- Files in bundle.json: ${b.files.length}${b.omitted.length ? `; left out for size: ${b.omitted.length}` : ''}.`, '');
  lines.push('## Sources', '');
  for (const s of b.sources) lines.push(...sourceSection(s));
  lines.push('## Candidate pages', '', ...probeTable(b.candidates));
  lines.push('## Portal robots.txt', '', ...probeTable(b.portals));
  lines.push('## Alerts', '');
  if (!b.alerts) lines.push('Not checked. Run with --alerts (the saved inbox, read-only) or --eml <folder>.', '');
  else {
    const a = b.alerts;
    lines.push(`- Read from: ${a.where.join(', ') || '(nothing)'}; e-mails: ${a.messages}`);
    for (const e of a.errors) lines.push(`- ${md(e)}`);
    lines.push(`- Per search term: ${Object.entries(a.termCounts).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    lines.push(`- Per sender: ${Object.entries(a.bySender).map(([t, n]) => `${t} ${n}`).join(', ') || '(none)'}`, '');
    lines.push('| E-mail | Sender | From | Subject | Notices | After scrub | First titles |', '|---|---|---|---|---|---|---|');
    for (const e of a.emails.slice(0, 60)) lines.push(`| ${md(e.id)} | ${e.sender} | ${md(e.from)} | ${md(e.subject)} | ${e.notices} | ${e.noticesAfterScrub} | ${md(e.titles.join('; '))} |`);
    lines.push('');
  }
  let text = finalScrub(lines.join('\n'));
  if (Buffer.byteLength(text) > REPORT_MAX_BYTES) {
    const note = '\n\n(The report was cut at 20 KB; bundle.json has everything.)\n';
    text = Buffer.from(text).subarray(0, REPORT_MAX_BYTES - Buffer.byteLength(note)).toString('utf8').replace(/�$/, '') + note;
  }
  return text;
}
