import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPipeline, MAX_REFETCH_PER_SOURCE } from '../src/server/pipeline/run.js';
import { makeEnv, type Env } from './helpers/pipelineEnv.js';

// MAT-9: notice pages of watched bids are read again (summer dates: Pacific is UTC-7).
const start = new Date('2026-06-15T20:00:00Z');
const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000);

let server: Server;
let base = '';
const page = { closing: 'July 9, 2026 2:00 PM', addendum: false, fail: false, count: 12 };
const hits = new Map<string, number>();

function noticeHtml(n: number): string {
  const docs = [`<a href="/site/docs/${n}-spec.pdf">Specification</a>`];
  if (page.addendum) docs.push(`<a href="/site/docs/${n}-addendum-1.pdf">Addendum 1</a>`);
  return `<html><body><main><h1>RFQ 26-${300 + n} Boulevard Mowing Area ${n}</h1>
    <p>The District of Saanich invites quotations for boulevard mowing and grass cutting in area ${n}.</p>
    <p>Closing date: ${page.closing}</p>
    <p>Submit by e-mail to purchasing@saanich.example.</p>
    ${docs.join(' ')}</main></body></html>`;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    hits.set(url, (hits.get(url) ?? 0) + 1);
    if (url === '/site/list' || url === '/blocked/list') {
      const prefix = url.split('/')[1];
      const items = Array.from({ length: page.count }, (_, i) => i + 1)
        .map((n) => `<li><a href="/${prefix}/notice/${n}">RFQ 26-${300 + n} Boulevard Mowing Area ${n}</a> Closing July 9, 2026 2:00 PM</li>`)
        .join('');
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<html><body><ul>${items}</ul></body></html>`);
      return;
    }
    const m = /^\/(site|blocked)\/notice\/(\d+)$/.exec(url);
    if (m) {
      if (page.fail) {
        res.writeHead(500).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(noticeHtml(Number(m[2])));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  Object.assign(page, { closing: 'July 9, 2026 2:00 PM', addendum: false, fail: false, count: 12 });
  hits.clear();
});

const config = (prefix: string) => ({
  url: `${base}/${prefix}/list`,
  linkPattern: `^/${prefix}/notice/\\d+$`,
  organization: 'District of Saanich',
  localBuyer: true,
});

function env(extra: { id: string; prefix: string }[] = [{ id: 'site', prefix: 'site' }]): Env {
  return makeEnv({
    noSamples: true,
    automation: { mode: 'discover' },
    extraSources: extra.map((e) => ({ id: e.id, name: `Site ${e.id}`, kind: 'html_list' as const, config: config(e.prefix) })),
  });
}

const rows = (e: Env, sourceId: string) =>
  e.store
    .listOpportunities({ view: 'all', limit: 100 }, e.clock.now)
    .items.filter((o) => o.sourceId === sourceId)
    .sort((a, b) => a.id - b.id);

const noticeHits = (prefix: string) => [...hits].filter(([u]) => u.startsWith(`/${prefix}/notice/`)).reduce((n, [, c]) => n + c, 0);

async function runAt(e: Env, hours: number) {
  e.clock.now = at(hours);
  return createPipeline(e.deps).run('manual');
}

describe('re-reading watched notice pages (MAT-9)', () => {
  it('records a new addendum and a moved closing on a pursued bid, at most every 12 hours', async () => {
    page.count = 2;
    const e = env();
    await runAt(e, 0);
    const [watched, other] = rows(e, 'site');
    expect(watched!.detailFetchedAt).not.toBeNull();
    e.store.setUserDecision(watched!.id, 'pursue');

    page.addendum = true;
    page.closing = 'July 16, 2026 2:00 PM';
    hits.clear();
    await runAt(e, 6);
    expect(noticeHits('site')).toBe(0);
    expect(e.store.listChanges(watched!.id)).toEqual([]);

    await runAt(e, 13);
    expect(hits.get('/site/notice/1')).toBe(1);
    expect(hits.get('/site/notice/2')).toBeUndefined(); // not watched
    const kinds = e.store.listChanges(watched!.id).map((c) => c.kind);
    // The page text names the new date too, so its description changed as well.
    expect(kinds).toEqual(expect.arrayContaining(['closing_moved', 'documents_added']));
    expect(e.store.listChanges(watched!.id).find((c) => c.kind === 'documents_added')!.addendum).toBe(true);
    expect(e.store.listChanges(other!.id)).toEqual([]);
    expect(e.store.listEvents(100).some((ev) => ev.kind === 'closing_changed' && ev.opportunityId === watched!.id)).toBe(true);

    // Nothing new the next time: no second set of change rows.
    await runAt(e, 26);
    expect(hits.get('/site/notice/1')).toBe(2);
    expect(e.store.listChanges(watched!.id)).toHaveLength(kinds.length);
  });

  it('counts a bid with a submitted application as watched, and reads at most 10 per source per run', async () => {
    const e = env();
    await runAt(e, 0);
    const all = rows(e, 'site');
    expect(all).toHaveLength(12);
    for (const o of all) {
      e.store.createApplication(
        {
          opportunityId: o.id,
          status: 'submitted',
          channel: 'email',
          toEmail: 'purchasing@saanich.example',
          ccEmail: '',
          subject: 'Submission',
          body: 'Hello',
          includeRates: false,
          checklist: [],
          documentIds: [],
          missing: [],
          autoGenerated: false,
        },
        e.clock.now,
      );
    }
    hits.clear();
    await runAt(e, 13);
    expect(noticeHits('site')).toBe(MAX_REFETCH_PER_SOURCE);
    hits.clear();
    await runAt(e, 14);
    // The two left over are read next, not the ten just read.
    expect(noticeHits('site')).toBe(2);
  });

  it('never re-reads for a source that refuses automated reading, and a failed re-read does not fail the run', async () => {
    page.count = 1;
    const e = env([
      { id: 'site', prefix: 'site' },
      { id: 'bonfire-saanich', prefix: 'blocked' },
    ]);
    await runAt(e, 0);
    for (const o of [...rows(e, 'site'), ...rows(e, 'bonfire-saanich')]) e.store.setUserDecision(o.id, 'pursue');
    hits.clear();
    page.fail = true;
    const run = await runAt(e, 13);
    expect(run.status).not.toBe('error');
    expect(noticeHits('site')).toBe(1);
    expect(noticeHits('blocked')).toBe(0);
    // The failed page is asked again next run.
    page.fail = false;
    hits.clear();
    await runAt(e, 14);
    expect(noticeHits('site')).toBe(1);
  });
});
