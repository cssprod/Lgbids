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
