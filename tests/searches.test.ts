import { afterEach, describe, expect, it } from 'vitest';
import { analysis, closeHarnesses, harness, NOW, seedOpportunity, type Harness } from './helpers/apiHarness.js';
import type { ServiceKey } from '../src/shared/schemas.js';

afterEach(closeHarnesses);

const post = (h: Harness, payload: Record<string, unknown>) => h.app.inject({ method: 'POST', url: '/api/saved-searches', payload });

describe('saved searches (UX-13)', () => {
  it('creates, lists, renames and deletes', async () => {
    const h = await harness();
    const created = await post(h, { name: 'Mowing in Saanich', filter: { view: 'suitable', service: 'lawn', place: 'Saanich', minScore: 60 } });
    expect(created.statusCode).toBe(200);
    const s = created.json();
    expect(s).toMatchObject({ name: 'Mowing in Saanich', filter: { service: 'lawn', place: 'Saanich', minScore: 60, view: 'suitable' } });

    const list = (await h.app.inject({ method: 'GET', url: '/api/saved-searches' })).json();
    expect(list.map((x: { name: string }) => x.name)).toEqual(['Mowing in Saanich']);

    const renamed = await h.app.inject({ method: 'PATCH', url: `/api/saved-searches/${s.id}`, payload: { name: 'Saanich lawns' } });
    expect(renamed.json()).toMatchObject({ name: 'Saanich lawns', filter: { service: 'lawn' } });

    expect((await h.app.inject({ method: 'DELETE', url: `/api/saved-searches/${s.id}` })).json()).toEqual({ ok: true });
    expect((await h.app.inject({ method: 'DELETE', url: `/api/saved-searches/${s.id}` })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'PATCH', url: '/api/saved-searches/999', payload: { name: 'X' } })).statusCode).toBe(404);
  });

  it('answers 409 for a name already taken, ignoring case', async () => {
    const h = await harness();
    await post(h, { name: 'Trees' });
    const dup = await post(h, { name: 'trees' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('You already have a search called “trees”. Choose another name.');
    const other = (await post(h, { name: 'Hedges' })).json();
    expect((await h.app.inject({ method: 'PATCH', url: `/api/saved-searches/${other.id}`, payload: { name: 'TREES' } })).statusCode).toBe(409);
  });

  it('validates the name and keeps at most 20', async () => {
    const h = await harness();
    expect((await post(h, { name: '' })).statusCode).toBe(400);
    expect((await post(h, { name: 'x'.repeat(61) })).statusCode).toBe(400);
    expect((await post(h, { name: 'Bad', filter: { minScore: 101 } })).statusCode).toBe(400);
    for (let i = 1; i <= 20; i++) expect((await post(h, { name: `Search ${i}` })).statusCode).toBe(200);
    const full = await post(h, { name: 'One more' });
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toMatch(/up to 20 saved searches/);
  });
});

/** Three suitable bids with different scores, work and places. */
async function seeded() {
  const h = await harness();
  const seed = (title: string, score: number, services: ServiceKey[], areaMatch: string) => {
    const id = seedOpportunity(h.deps, { title });
    h.deps.store.saveAnalysis(
      id,
      {
        noticeType: 'RFQ',
        score,
        decision: 'suitable',
        analysis: { ...analysis(), services, areaMatch },
        submissionMethod: 'email',
        submissionEmail: 'bids@saanich.example',
        submissionUrl: '',
      },
      NOW,
    );
    return id;
  };
  const mowing = seed('Park mowing', 85, ['lawn'], 'Saanich');
  const trees = seed('Tree pruning', 55, ['tree'], 'Esquimalt');
  const beds = seed('Planting beds', 70, ['garden', 'lawn'], 'Oak Bay');
  return { h, mowing, trees, beds };
}

const ids = async (h: Harness, qs: string) =>
  ((await h.app.inject({ method: 'GET', url: `/api/opportunities?view=suitable&${qs}` })).json().items as { id: number }[]).map((o) => o.id).sort();

describe('list filters (UX-13)', () => {
  it('filters by lowest score', async () => {
    const { h, mowing, beds } = await seeded();
    expect(await ids(h, 'minScore=70')).toEqual([mowing, beds].sort());
    expect((await h.app.inject({ method: 'GET', url: '/api/opportunities?minScore=high' })).statusCode).toBe(400);
  });

  it('filters by kind of work', async () => {
    const { h, mowing, beds } = await seeded();
    expect(await ids(h, 'service=lawn')).toEqual([mowing, beds].sort());
    const bad = await h.app.inject({ method: 'GET', url: '/api/opportunities?service=pools' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/not a kind of work/);
  });

  it('filters by place, ignoring case', async () => {
    const { h, trees } = await seeded();
    expect(await ids(h, 'place=esquimalt')).toEqual([trees]);
  });

  it('applies the filters to the CSV and adds the award columns', async () => {
    const { h, mowing, beds } = await seeded();
    h.deps.store.saveAward(
      {
        opportunityId: mowing,
        noticeOpportunityId: null,
        orgKey: 'saanich',
        refKey: 'RFQ261',
        title: 'Park mowing',
        winner: 'Blue Co',
        amount: 48_500,
        amountText: '',
        awardedOn: '2026-07-02',
        url: '',
        excerpt: '',
        origin: 'manual',
        status: 'confirmed',
        notes: '',
      },
      NOW,
    );
    const res = await h.app.inject({ method: 'GET', url: '/api/opportunities.csv?view=suitable&service=lawn&minScore=60' });
    const lines = res.body.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('Title,Buyer,Source,Reference,Type,Decision,Score,Closes,Submission,Link,First seen,Winner,Winning price,Awarded on,Award status');
    expect(lines).toHaveLength(3);
    expect(res.body).toContain(',Blue Co,48500,2026-07-02,Confirmed');
    expect(res.body).not.toContain('Tree pruning');
    expect(lines.some((l) => l.startsWith('Planting beds,') && l.endsWith(',,,,'))).toBe(true);
    expect(beds).toBeGreaterThan(0);
  });
});
