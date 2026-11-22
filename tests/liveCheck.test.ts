import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sourceConfigSchema } from '../src/shared/schemas.js';
import { openDatabase } from '../src/server/db/database.js';
import { createStore } from '../src/server/db/store.js';
import { defaultRegion } from '../src/server/matching/geo.js';
import type { AlertMailbox } from '../src/server/sources/alerts/mailbox.js';
import { createLiveCheckHttp, finalScrub, recordsFrom, REPORT_MAX_BYTES, runLiveCheck, type LiveCheckOptions } from '../src/server/sources/liveCheck.js';
import type { DefaultSource } from '../src/server/sources/registry.js';
import { parseArgs, readSavedInbox } from '../src/server/cli/liveCheck.js';
// @ts-expect-error plain JavaScript script without type declarations
import { importBundle, targetFor } from '../scripts/import-live-check.mjs';
import { fixtureUrl, NOW, sources, startFixtures, stopFixtures } from './helpers/pipelineEnv.js';

const temp: string[] = [];
beforeAll(startFixtures);
afterAll(async () => {
  await stopFixtures();
  for (const d of temp.splice(0)) rmSync(d, { recursive: true, force: true });
});

// The sample sites as built-in sources; CivicInfo is the blocked one, as in the registry.
function defs(): DefaultSource[] {
  return sources().map((s) => ({ id: s.id, name: s.name, kind: s.kind, notes: '', config: sourceConfigSchema.parse(s.config), enabled: true, forceOff: s.id === 'civicinfo' }));
}

/** A real-looking alert e-mail: a personal recipient and contact, both of which must be scrubbed. */
const alert = Buffer.from(
  [
    'From: BC Bid <noreply@bcbid.gov.bc.ca>',
    'To: Robin Person <robin.person@gmail.com>',
    'Subject: BC Bid: new opportunities',
    'Date: Mon, 15 Jun 2026 08:00:00 -0700',
    'Message-ID: <abc123@mail.gmail.com>',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<table><tr><th>Opportunity ID</th><th>Description</th><th>Organization</th><th>Closing Date</th></tr>' +
      '<tr><td>CS-2026-114</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91234">Boulevard Mowing and Trimming Services</a></td><td>City of Langford</td><td>2026-07-09 2:00 PM</td></tr></table>' +
      '<p>Questions: robin.person@gmail.com or 250-381-2222.</p>',
  ].join('\r\n'),
);

function mailbox(): AlertMailbox & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchNew(since) {
      calls.push(`fetchNew:${since === null ? 'start' : 'resume'}`);
      return { messages: [{ id: 'imap:1', raw: alert }], position: null };
    },
    async test() {
      calls.push('test');
      return { count: 1 };
    },
  };
}

function counted(): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return fetch(input, init);
  }) as typeof fetch;
  return { fetchImpl, urls };
}

async function run(extra: Partial<LiveCheckOptions> = {}, fetchImpl?: typeof fetch) {
  const { http, recorder } = createLiveCheckHttp({ allowPrivate: true, delayMs: 0, fetchImpl });
  const u = fixtureUrl();
  return runLiveCheck({
    http,
    recorder,
    now: NOW,
    region: defaultRegion(),
    sources: recordsFrom(defs(), NOW),
    candidates: [
      { buyer: 'Township of Esquimalt', url: `${u}/esquimalt/business-development/bids-tenders` },
      { buyer: 'Hidden buyer', url: `${u}/private/listing` },
    ],
    portals: [
      { name: 'Sample portal', url: `${u}/` },
      { name: 'Robots-only portal', url: `${u}/crd/contracts-rfps/current`, robotsOnly: true },
    ],
    ...extra,
  });
}

describe('live-check kit', () => {
  it('writes every report section and a per-source entry', async () => {
    const { report, bundle } = await run({ mailbox: mailbox() });
    for (const heading of ['# Lgbids live check', '> Privacy:', '## Summary', '## Sources', '## Candidate pages', '## Portal robots.txt', '## Alerts']) {
      expect(report).toContain(heading);
    }
    for (const s of sources()) expect(report).toContain(`(\`${s.id}\`)`);
    expect(Buffer.byteLength(report)).toBeLessThanOrEqual(REPORT_MAX_BYTES);
    const esq = bundle.sources.find((s) => s.id === 'esquimalt')!;
    expect(esq.robots).toBe('allowed');
    expect(esq.skipped).toBeUndefined();
    expect(esq.status).toMatch(/ok|empty/);
    expect(esq.httpStatus).toBe(200);
    expect(esq.hostChanged).toBe(false);
    expect(esq.samples.length).toBeLessThanOrEqual(5);
    expect(esq.noticePages.length).toBeLessThanOrEqual(2);
    expect(Array.isArray(esq.rejected)).toBe(true);
    expect(report).toMatch(/with a closing date: \d+%; with a reference: \d+%/);
  });

  it('reads robots.txt first and does not open a page it disallows', async () => {
    const c = counted();
    const { bundle } = await run({}, c.fetchImpl);
    const hidden = bundle.candidates.find((x) => x.label === 'Hidden buyer')!;
    expect(hidden.robots).toBe('disallowed');
    expect(hidden.fetched).toBe(false);
    expect(c.urls.some((u) => u.endsWith('/private/listing'))).toBe(false);
    const allowed = bundle.candidates.find((x) => x.label === 'Township of Esquimalt')!;
    expect(allowed.fetched).toBe(true);
    const robotsOnly = bundle.portals.find((p) => p.label === 'Robots-only portal')!;
    expect(robotsOnly.fetched).toBe(false);
    // One robots.txt request for the whole run, although every check consults it.
    expect(c.urls.filter((u) => u.endsWith('/robots.txt'))).toHaveLength(1);
  });

  it('skips blocked sources unless --include-blocked, and then reads only robots.txt', async () => {
    const off = counted();
    const without = await run({ candidates: [], portals: [] }, off.fetchImpl);
    const civic = without.bundle.sources.find((s) => s.id === 'civicinfo')!;
    expect(civic.skipped).toMatch(/--include-blocked/);
    expect(off.urls.some((u) => u.includes('/civicinfo/'))).toBe(false);

    const on = counted();
    const withFlag = await run({ candidates: [], portals: [], sources: recordsFrom(defs().filter((d) => d.id === 'civicinfo'), NOW), includeBlocked: true }, on.fetchImpl);
    expect(withFlag.bundle.sources[0]!.robots).toBe('allowed');
    expect(withFlag.bundle.sources[0]!.skipped).toMatch(/only its robots\.txt/);
    expect(on.urls).toEqual([`${fixtureUrl()}/robots.txt`]);
  });

  it('keeps scrubbed pages with --save-html and leaves no address outside .example in the bundle', async () => {
    const box = mailbox();
    const { bundle, report } = await run({ saveHtml: true, mailbox: box });
    const paths = bundle.files.map((f) => f.path);
    expect(paths).toContain('live/esquimalt/listing.html');
    expect(paths.filter((p) => p.startsWith('live/esquimalt/notice-')).length).toBeLessThanOrEqual(2);
    expect(paths).toContain('alerts/bcbid-1.eml');
    expect(box.calls).toEqual(['fetchNew:start']);

    const json = JSON.stringify(bundle);
    expect(json.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    for (const m of `${json}\n${report}`.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) expect(m[1]).toMatch(/\.example$/);
    expect(json).not.toContain('gmail.com"');
    expect(json).not.toContain('381-2222');

    const a = bundle.alerts!;
    expect(a.messages).toBe(1);
    expect(a.termCounts.bcbid).toBe(1);
    expect(a.bySender.bcbid).toBe(1);
    expect(a.emails[0]!.notices).toBe(1);
    // The scrubbed copy still reads the same, so it can become a fixture.
    expect(a.emails[0]!.noticesAfterScrub).toBe(1);
  });

  it('reads saved .eml files with --eml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lgbids-eml-'));
    temp.push(dir);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'a.eml'), alert);
    const { bundle, report } = await run({ sources: [], candidates: [], portals: [], emlDir: dir });
    expect(bundle.alerts!.where).toEqual(['saved .eml files']);
    expect(bundle.alerts!.emails[0]!.id).toBe('a.eml');
    expect(report).toContain('Per search term:');
  });

  it('finalScrub keeps .example addresses and moves others under .example', () => {
    expect(finalScrub('a@b.example and x@gmail.com')).toBe('a@b.example and name@gmail.com.example');
  });
});

describe('import-live-check script', () => {
  it('writes bundle files under tests/fixtures and refuses unsafe paths or addresses', () => {
    const root = mkdtempSync(join(tmpdir(), 'lgbids-import-'));
    temp.push(root);
    const result = importBundle(
      {
        version: 1,
        files: [
          { path: 'live/esquimalt/listing.html', content: '<p>ok</p>' },
          { path: 'alerts/bcbid-1.eml', content: 'From: name@bcbid.gov.bc.ca.example\n\nhi' },
          { path: '../evil.html', content: 'x' },
          { path: 'live/x/../../a.html', content: 'x' },
          { path: 'alerts/leak.eml', content: 'To: robin@gmail.com' },
        ],
      },
      root,
    );
    expect(result.written).toEqual([join('tests', 'fixtures', 'live', 'esquimalt', 'listing.html'), join('tests', 'fixtures', 'alerts', 'bcbid-1.eml')]);
    expect(result.refused.map((r: { path: string }) => r.path)).toEqual(['../evil.html', 'live/x/../../a.html', 'alerts/leak.eml']);
    expect(readFileSync(join(root, 'tests', 'fixtures', 'live', 'esquimalt', 'listing.html'), 'utf8')).toBe('<p>ok</p>');
    expect(targetFor('live/a/b.txt')).toBeNull();
    expect(() => importBundle({ version: 2 }, root)).toThrow(/not a live-check bundle/);
  });
});

describe('live-check command line', () => {
  it('parses the options', () => {
    expect(parseArgs(['--include-blocked', '--save-html', '--alerts', '--eml', 'mail', '--only', 'a,b'])).toEqual({
      includeBlocked: true,
      saveHtml: true,
      alerts: true,
      eml: 'mail',
      only: ['a', 'b'],
      out: null,
    });
    expect(() => parseArgs(['--eml'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
  });

  it('reads the saved alert inbox without changing the database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lgbids-lc-db-'));
    temp.push(dir);
    const path = join(dir, 'lgbids.sqlite');
    const store = createStore(openDatabase(path));
    store.setSetting('alertInbox', { host: 'imap.mail.example', user: 'bids@garryoak.example', pass: 'app-pass' }, NOW);
    store.close();
    const before = statSync(path).mtimeMs;
    const bytes = readFileSync(path);
    const inbox = readSavedInbox(dir, {})!;
    expect(inbox).toMatchObject({ host: 'imap.mail.example', user: 'bids@garryoak.example', pass: 'app-pass', folder: 'INBOX' });
    expect(readSavedInbox(dir, { ALERT_IMAP_PASS: 'from-env' })!.pass).toBe('from-env');
    expect(statSync(path).mtimeMs).toBe(before);
    expect(readFileSync(path).equals(bytes)).toBe(true);
    expect(readSavedInbox(join(dir, 'missing'))).toBeNull();
  });
});
