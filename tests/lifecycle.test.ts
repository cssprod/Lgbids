import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '../src/server/contracts.js';
import { openDatabase } from '../src/server/db/database.js';
import { createStore } from '../src/server/db/store.js';
import { createPipeline } from '../src/server/pipeline/run.js';
import type { RawOpportunity } from '../src/server/sources/types.js';
import { sourceConfigSchema } from '../src/shared/schemas.js';
import { makeEnv } from './helpers/pipelineEnv.js';

const now = new Date('2026-06-15T20:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

const undated = (externalId: string): RawOpportunity => ({
  externalId,
  title: `Boulevard Mowing Services ${externalId}`,
  url: `https://bids.example/${externalId}`,
  organization: 'District of Saanich',
  closing: null,
});

describe('undated rows and closeExpired (MAT-11)', () => {
  let store: Store;
  beforeEach(() => {
    store = createStore(openDatabase(':memory:'));
    store.insertSource({ id: 'alerts', name: 'Alert e-mails', kind: 'email_alerts', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, now);
    store.insertSource({ id: 'list', name: 'Listing', kind: 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, now);
  });

  it('keeps an undated alert row open after 22 days but closes a listing row', () => {
    const alert = store.upsertOpportunity('alerts', undated('a1'), false, daysAgo(22)).id;
    const listed = store.upsertOpportunity('list', undated('l1'), false, daysAgo(22)).id;
    expect(store.closeExpired(now)).toEqual([listed]);
    expect(store.getOpportunity(alert)!.status).toBe('open');
  });

  it('keeps an undated pursued row open', () => {
    const pursued = store.upsertOpportunity('list', undated('l2'), false, daysAgo(22)).id;
    store.setUserDecision(pursued, 'pursue');
    expect(store.closeExpired(now)).toEqual([]);
    expect(store.getOpportunity(pursued)!.status).toBe('open');
  });
});

describe('a closed bid whose closing is moved into the future reopens', () => {
  let store: Store;
  const firstClosing = { iso: '2026-06-20T21:00:00Z', precision: 'datetime' as const };
  const extended = { iso: '2026-07-09T21:00:00Z', precision: 'datetime' as const };
  const afterClose = new Date('2026-06-22T18:00:00Z');
  const notice = (over: Partial<RawOpportunity> = {}): RawOpportunity => ({
    externalId: 'n-1',
    title: 'RFQ 26-210 Boulevard Mowing Services',
    url: 'https://bids.example/n-1',
    organization: 'District of Saanich',
    closing: firstClosing,
    ...over,
  });
  beforeEach(() => {
    store = createStore(openDatabase(':memory:'));
    store.insertSource({ id: 'alerts', name: 'Alert e-mails', kind: 'email_alerts', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, now);
    store.insertSource({ id: 'list', name: 'Listing', kind: 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, now);
  });
  const closedRow = () => {
    const id = store.upsertOpportunity('list', notice(), false, now).id;
    expect(store.closeExpired(new Date('2026-06-21T18:00:00Z'))).toEqual([id]);
    return id;
  };

  it('on the listing, with or without a stated status', () => {
    const id = closedRow();
    store.upsertOpportunity('list', notice({ closing: extended }), false, afterClose);
    expect(store.getOpportunity(id)).toMatchObject({ status: 'open', closesAt: extended.iso });

    const other = store.upsertOpportunity('list', notice({ externalId: 'n-2', url: 'https://bids.example/n-2' }), false, now).id;
    store.closeExpired(new Date('2026-06-21T18:00:00Z'));
    store.upsertOpportunity('list', notice({ externalId: 'n-2', url: 'https://bids.example/n-2', closing: extended, status: 'open' }), false, afterClose);
    expect(store.getOpportunity(other)!.status).toBe('open');
  });

  it('on the notice page', () => {
    const id = closedRow();
    store.applyDetail(id, { closing: extended }, afterClose);
    expect(store.getOpportunity(id)).toMatchObject({ status: 'open', closesAt: extended.iso });
  });

  it('on an alert e-mail about the notice', () => {
    const id = closedRow();
    store.upsertOpportunity('alerts', { externalId: 'alert-1', title: 'Addendum 1', url: 'https://bids.example/n-1', event: 'addendum', closing: extended }, false, afterClose);
    expect(store.getOpportunity(id)).toMatchObject({ status: 'open', closesAt: extended.iso });
  });

  it('stays closed when the buyer says closed, or the new closing has passed too', () => {
    const id = closedRow();
    store.upsertOpportunity('list', notice({ closing: extended, status: 'closed' }), false, afterClose);
    expect(store.getOpportunity(id)!.status).toBe('closed');

    const past = store.upsertOpportunity('list', notice({ externalId: 'n-3', url: 'https://bids.example/n-3' }), false, now).id;
    store.closeExpired(new Date('2026-06-21T18:00:00Z'));
    store.upsertOpportunity('list', notice({ externalId: 'n-3', url: 'https://bids.example/n-3', closing: { iso: '2026-06-21T21:00:00Z', precision: 'datetime' } }), false, afterClose);
    expect(store.getOpportunity(past)!.status).toBe('closed');

    const cancelled = store.upsertOpportunity('list', notice({ externalId: 'n-4', url: 'https://bids.example/n-4' }), false, now).id;
    store.closeExpired(new Date('2026-06-21T18:00:00Z'));
    store.upsertOpportunity('alerts', { externalId: 'alert-4', title: 'Cancelled', url: 'https://bids.example/n-4', event: 'cancellation', closing: extended }, false, afterClose);
    expect(store.getOpportunity(cancelled)!.status).toBe('cancelled');
  });

  it('a slow copy of the notice never reopens an awarded or cancelled bid', () => {
    store.insertSource({ id: 'list2', name: 'Other listing', kind: 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, now);
    for (const [n, event] of [['5', 'award'], ['6', 'cancellation']] as const) {
      const a = store.upsertOpportunity('list', notice({ externalId: `a-${n}`, url: `https://bids.example/a-${n}`, title: `RFQ 26-21${n} Boulevard Mowing Services` }), false, now).id;
      const b = store.upsertOpportunity('list2', notice({ externalId: `b-${n}`, url: `https://other.example/b-${n}`, title: `RFQ 26-21${n} Boulevard Mowing Services` }), false, now).id;
      expect(store.linkDuplicate(b)).toBe(a);
      store.closeExpired(new Date('2026-06-21T18:00:00Z'));
      store.upsertOpportunity('alerts', { externalId: `alert-${n}`, title: 'Result', url: `https://bids.example/a-${n}`, event }, false, afterClose);
      const final = event === 'award' ? 'awarded' : 'cancelled';
      expect(store.getOpportunity(a)!.status).toBe(final);
      store.upsertOpportunity('list2', notice({ externalId: `b-${n}`, url: `https://other.example/b-${n}`, title: `RFQ 26-21${n} Boulevard Mowing Services`, closing: extended }), false, afterClose);
      expect(store.getOpportunity(a)!.status).toBe(final);
      expect(store.getOpportunity(b)!.status).toBe('closed');
    }
  });
});

describe('notice pages that refuse automated reading (COV-17)', () => {
  let server: Server;
  let base = '';
  const hits: Record<string, number> = {};
  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? '/';
      hits[path] = (hits[path] ?? 0) + 1;
      if (path === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /notice/\n');
      } else if (path === '/list') {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<html><body><ul><li><a href="/notice/1">RFQ 26-201 Boulevard Mowing Services</a> Closing July 9, 2026</li></ul></body></html>');
      } else {
        res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>Notice</body></html>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('asks for a disallowed notice page at most once across two runs and says to open it in a browser', async () => {
    const env = makeEnv({
      noSamples: true,
      extraSources: [
        { id: 'blocked-list', name: 'Blocked pages', kind: 'html_list', config: { url: `${base}/list`, organization: 'District of Saanich', localBuyer: true, fetchDetails: true } },
      ],
    });
    await createPipeline(env.deps).run('manual');
    env.clock.now = new Date(env.clock.now.getTime() + 3_600_000);
    await createPipeline(env.deps).run('manual');
    expect(hits['/list']).toBe(2);
    // robots.txt refuses the page, so the page itself is never fetched.
    expect(hits['/notice/1'] ?? 0).toBe(0);
    const blocked = env.store.listEvents(100).filter((e) => e.kind === 'detail_blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.message).toMatch(/browser/);
  });
});
