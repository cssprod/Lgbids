import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '../src/server/contracts.js';
import { openDatabase } from '../src/server/db/database.js';
import { createStore, type ChangeStore } from '../src/server/db/store.js';
import { diffNotice, type NoticeSnapshot } from '../src/server/matching/changes.js';
import { createPipeline } from '../src/server/pipeline/run.js';
import type { RawOpportunity } from '../src/server/sources/types.js';
import { sourceConfigSchema } from '../src/shared/schemas.js';
import { makeEnv } from './helpers/pipelineEnv.js';

// Summer dates: Pacific time is UTC-7 whichever time zone rules the runtime has.
const now = new Date('2026-06-15T20:00:00Z');
const later = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

const snap = (overrides: Partial<NoticeSnapshot> = {}): NoticeSnapshot => ({
  closesAt: '2026-07-09T21:00:00Z',
  closesAtPrecision: 'datetime',
  status: 'open',
  documents: [{ name: 'Specification', url: 'https://bids.example/spec.pdf' }],
  description: 'Boulevard mowing in Saanich.',
  ...overrides,
});

describe('diffNotice (MAT-8)', () => {
  it('reports a moved closing with a plain sentence', () => {
    const [c, ...rest] = diffNotice(snap(), snap({ closesAt: '2026-07-16T21:00:00Z' }));
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ kind: 'closing_moved', before: '2026-07-09T21:00:00Z', after: '2026-07-16T21:00:00Z', addendum: false });
    expect(c!.summary).toBe('The closing date moved from Thu, Jul 9, 2026 at 2:00 PM PDT to Thu, Jul 16, 2026 at 2:00 PM PDT.');
  });

  it('classifies a same-day date gaining its time as closing_refined', () => {
    const before = snap({ closesAt: '2026-07-10T06:59:59Z', closesAtPrecision: 'date' });
    expect(diffNotice(before, snap()).map((c) => c.kind)).toEqual(['closing_refined']);
    // The other way round says nothing new.
    expect(diffNotice(snap(), before)).toEqual([]);
  });

  it('compares date-only closings by their sending deadline', () => {
    // End of the local day and a minute earlier on the same date are the same deadline.
    const a = snap({ closesAt: '2026-07-10T06:59:59Z', closesAtPrecision: 'date' });
    const b = snap({ closesAt: '2026-07-10T06:58:00Z', closesAtPrecision: 'date' });
    expect(diffNotice(a, b)).toEqual([]);
    const moved = snap({ closesAt: '2026-07-17T06:59:59Z', closesAtPrecision: 'date' });
    expect(diffNotice(a, moved).map((c) => c.kind)).toEqual(['closing_moved']);
  });

  it('reports a closing that becomes known, and never a closing taken away', () => {
    expect(diffNotice(snap({ closesAt: null, closesAtPrecision: null }), snap()).map((c) => c.kind)).toEqual(['closing_added']);
    expect(diffNotice(snap(), snap({ closesAt: null, closesAtPrecision: null }))).toEqual([]);
  });

  it('flags new documents that look like an addendum', () => {
    const docs = [...snap().documents, { name: 'Addendum No. 1', url: 'https://bids.example/add1.pdf' }];
    const [c] = diffNotice(snap(), snap({ documents: docs }));
    expect(c).toMatchObject({ kind: 'documents_added', addendum: true, after: 'Addendum No. 1' });
    const plain = diffNotice(snap(), snap({ documents: [...snap().documents, { name: 'Site map', url: 'https://bids.example/map.pdf' }] }));
    expect(plain[0]).toMatchObject({ kind: 'documents_added', addendum: false });
  });

  it('does not count the first documents of a notice unless one is an addendum', () => {
    expect(diffNotice(snap({ documents: [] }), snap())).toEqual([]);
    const amended = diffNotice(snap({ documents: [] }), snap({ documents: [{ name: 'Spec', url: 'https://bids.example/revised-spec.pdf' }] }));
    expect(amended.map((c) => c.kind)).toEqual(['documents_added']);
  });

  it('reports status and text changes, but not a summary growing into the full text', () => {
    expect(diffNotice(snap(), snap({ status: 'cancelled' }))[0]).toMatchObject({ kind: 'status_changed', before: 'open', after: 'cancelled' });
    expect(diffNotice(snap(), snap({ description: 'Boulevard mowing in Saanich. Three cuts a month.' }))).toEqual([]);
    expect(diffNotice(snap(), snap({ description: 'Hedge trimming in Oak Bay.' })).map((c) => c.kind)).toEqual(['description_changed']);
  });
});

describe('changes in the store (MAT-8)', () => {
  let store: ChangeStore;
  const raw = (overrides: Partial<RawOpportunity> = {}): RawOpportunity => ({
    externalId: 'n-1',
    title: 'RFQ 2026-041 Boulevard Mowing Services',
    url: 'https://bids.example/n-1',
    organization: 'District of Saanich',
    closing: { iso: '2026-07-09T21:00:00Z', precision: 'datetime' },
    closingRaw: 'July 9, 2026 2:00 PM',
    ...overrides,
  });

  beforeEach(() => {
    store = createStore(openDatabase(':memory:'));
    for (const id of ['a', 'b', 'alerts']) {
      store.insertSource({ id, name: `Source ${id}`, kind: id === 'alerts' ? 'email_alerts' : 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, now);
    }
  });

  // The dup.ts probe: the extension is only on the copy.
  it('carries an extension on a duplicate to the canonical row, and keeps it against the stale listing', () => {
    const canonical = store.upsertOpportunity('a', raw(), false, now).id;
    const copy = store.upsertOpportunity('b', raw({ externalId: 'b-1', url: 'https://other.example/b-1' }), false, now).id;
    expect(store.linkDuplicate(copy)).toBe(canonical);
    store.saveAnalysis(
      canonical,
      { noticeType: 'RFQ', score: 70, decision: 'suitable', analysis: { relevance: 80, matchedTerms: [], services: [], area: 'yes', areaMatch: '', reasons: [], requirements: [], pricing: 'unknown', alsoListed: [] }, submissionMethod: 'email', submissionEmail: 'bids@saanich.example', submissionUrl: '' },
      now,
    );

    const moved = store.upsertOpportunity('b', raw({ externalId: 'b-1', url: 'https://other.example/b-1', closing: { iso: '2026-07-16T21:00:00Z', precision: 'datetime' } }), false, later(1));
    expect(moved.closingChanged).toBe(true);
    let row = store.getOpportunity(canonical)!;
    expect(row.closesAt).toBe('2026-07-16T21:00:00Z');
    expect(row.analysedAt).toBeNull();
    expect(row.changes?.map((c) => c.kind)).toEqual(['closing_moved']);
    expect(row.unseenChanges).toBe(1);

    // The canonical site still shows 9 July on the next run: not a new observation.
    const stale = store.upsertOpportunity('a', raw(), false, later(2));
    expect(stale.changes).toEqual([]);
    row = store.getOpportunity(canonical)!;
    expect(row.closesAt).toBe('2026-07-16T21:00:00Z');

    // On 10 July the bid is still open.
    expect(store.closeExpired(new Date('2026-07-10T20:00:00Z'))).not.toContain(canonical);
    expect(store.getOpportunity(canonical)!.status).toBe('open');
  });

  it('carries a cancellation and new documents from a duplicate', () => {
    const canonical = store.upsertOpportunity('a', raw({ documents: [{ name: 'Spec', url: 'https://bids.example/spec.pdf' }] }), false, now).id;
    const copy = store.upsertOpportunity('b', raw({ externalId: 'b-1', url: 'https://other.example/b-1', documents: [{ name: 'Spec', url: 'https://bids.example/spec.pdf' }] }), false, now).id;
    store.linkDuplicate(copy);
    store.upsertOpportunity('b', raw({ externalId: 'b-1', url: 'https://other.example/b-1', status: 'cancelled', documents: [{ name: 'Addendum 1', url: 'https://other.example/add1.pdf' }] }), false, later(1));
    const row = store.getOpportunity(canonical)!;
    expect(row.status).toBe('cancelled');
    expect(row.documents.map((d) => d.url)).toEqual(['https://bids.example/spec.pdf', 'https://other.example/add1.pdf']);
    expect(row.changes?.find((c) => c.kind === 'documents_added')?.addendum).toBe(true);
  });

  it('records the change under the run in progress', () => {
    const id = store.upsertOpportunity('a', raw(), false, now).id;
    const run = store.startRun('manual', now);
    const r = store.upsertOpportunity('a', raw({ closing: { iso: '2026-07-16T21:00:00Z', precision: 'datetime' } }), false, later(1));
    expect(r.changes[0]!.runId).toBe(run.id);
    expect(store.listChanges(id)[0]!.runId).toBe(run.id);
  });

  it('lets an alert addendum for a known notice update that row instead of adding one', () => {
    const id = store.upsertOpportunity('a', raw(), false, now).id;
    const before = store.listOpportunities({ view: 'all' }, now).total;
    const r = store.upsertOpportunity(
      'alerts',
      {
        externalId: 'alert:bonfire:x1',
        title: 'Addendum 1 posted: RFQ 2026-041 Boulevard Mowing Services',
        url: 'https://bids.example/n-1',
        event: 'addendum',
        status: 'open',
        closing: { iso: '2026-07-16T21:00:00Z', precision: 'datetime' },
        documents: [{ name: 'Addendum 1', url: 'https://bids.example/add1.pdf' }],
      },
      false,
      later(1),
    );
    expect(r).toMatchObject({ id, isNew: false, closingChanged: true });
    expect(r.changes.map((c) => c.kind).sort()).toEqual(['closing_moved', 'documents_added']);
    const row = store.getOpportunity(id)!;
    expect(row.title).toBe('RFQ 2026-041 Boulevard Mowing Services');
    expect(row.closesAt).toBe('2026-07-16T21:00:00Z');
    expect(store.listOpportunities({ view: 'all' }, now).total).toBe(before);
  });

  it('lets a cancellation alert for a known notice cancel it', () => {
    const id = store.upsertOpportunity('a', raw(), false, now).id;
    const r = store.upsertOpportunity('alerts', { externalId: 'alert:bonfire:x2', title: 'Cancelled: Boulevard Mowing', url: 'https://bids.example/n-1', event: 'cancellation', status: 'cancelled' }, false, later(1));
    expect(r.id).toBe(id);
    expect(store.getOpportunity(id)!.status).toBe('cancelled');
    expect(r.changes.map((c) => c.kind)).toEqual(['status_changed']);
  });
});

describe('closing changes in a run (MAT-8)', () => {
  let server: Server;
  let base = '';
  const closing = { a: 'July 9, 2026', b: 'July 9, 2026' };
  beforeAll(async () => {
    server = createServer((req, res) => {
      const which = req.url === '/a/list' ? 'a' : req.url === '/b/list' ? 'b' : null;
      if (!which) {
        res.writeHead(404).end();
        return;
      }
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(`<html><body><ul><li><a href="/${which}/notice/1">RFQ 26-201 Boulevard Mowing Services</a> Closing ${closing[which]}</li></ul></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    closing.a = 'July 9, 2026';
    closing.b = 'July 9, 2026';
  });

  const env2 = () =>
    makeEnv({
      noSamples: true,
      extraSources: [
        { id: 'site-a', name: 'Site A', kind: 'html_list', config: { url: `${base}/a/list`, organization: 'District of Saanich', localBuyer: true, fetchDetails: false } },
        { id: 'site-b', name: 'Site B', kind: 'html_list', config: { url: `${base}/b/list`, organization: 'District of Saanich', localBuyer: true, fetchDetails: false } },
      ],
    });

  const canonicalOf = (store: Store) => {
    const items = store.listOpportunities({ view: 'all', limit: 50 }, now).items;
    expect(items).toHaveLength(1);
    return items[0]!;
  };

  // The dup.ts probe end to end: the canonical stays open until 16 July and the draft stays alive.
  it('keeps the bid and its draft alive when only the copy shows the extension', async () => {
    const env = env2();
    await createPipeline(env.deps).run('manual');
    const canon = canonicalOf(env.store);
    const app =
      env.store.getApplicationByOpportunity(canon.id) ??
      env.store.createApplication(
        {
          opportunityId: canon.id,
          status: 'needs_input',
          channel: 'email',
          toEmail: 'bids@saanich.example',
          ccEmail: '',
          subject: 'Submission',
          body: 'Hello',
          includeRates: false,
          checklist: [],
          documentIds: [],
          missing: [],
          autoGenerated: false,
        },
        env.clock.now,
      );

    closing.b = 'July 16, 2026';
    env.clock.now = later(1);
    await createPipeline(env.deps).run('manual');
    env.clock.now = new Date('2026-07-10T20:00:00Z');
    await createPipeline(env.deps).run('manual');

    const row = env.store.getOpportunity(canon.id)!;
    expect(row.status).toBe('open');
    expect(row.closesAt?.startsWith('2026-07-17')).toBe(true); // end of 16 July, Pacific time
    expect(env.store.getApplication(app.id)!.status).not.toBe('expired');
    expect(row.changes?.filter((c) => c.kind === 'closing_moved')).toHaveLength(1);
  });

  it('records a moved closing even when nobody has started an application', async () => {
    const env = makeEnv({
      noSamples: true,
      automation: { mode: 'discover' },
      extraSources: [{ id: 'site-a', name: 'Site A', kind: 'html_list', config: { url: `${base}/a/list`, organization: 'District of Saanich', localBuyer: true, fetchDetails: false } }],
    });
    await createPipeline(env.deps).run('manual');
    const id = canonicalOf(env.store).id;
    expect(env.store.getApplicationByOpportunity(id)).toBeUndefined();
    closing.a = 'July 16, 2026';
    env.clock.now = later(1);
    await createPipeline(env.deps).run('manual');
    const events = env.store.listEvents(100).filter((e) => e.kind === 'closing_changed');
    expect(events).toHaveLength(1);
    expect(events[0]!.opportunityId).toBe(id);
    expect(events[0]!.applicationId).toBeNull();
    expect(env.store.listChanges(id).map((c) => c.kind)).toEqual(['closing_moved']);
  });
});
