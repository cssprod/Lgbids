import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, createApp, harness, NOW, seedOpportunity, type Harness } from './helpers/apiHarness.js';

afterEach(closeHarnesses);

const put = (h: Harness, id: number, payload: unknown) => h.app.inject({ method: 'PUT', url: `/api/opportunities/${id}/award`, payload: payload as Record<string, unknown> });

/** A parsed award notice's values, as MAT-16 stores them, with the event it logs. */
function suggest(h: Harness, opportunityId: number, applicationId: number | null, winner: string) {
  h.deps.store.saveAward(
    {
      opportunityId,
      noticeOpportunityId: null,
      orgKey: 'saanich',
      refKey: 'RFQ261',
      title: 'Park mowing',
      winner,
      amount: 48_500,
      amountText: '$48,500',
      awardedOn: '2026-07-02',
      url: 'https://town.example/awards/1',
      excerpt: `The contract was awarded to ${winner} for $48,500.`,
      origin: 'parsed',
      status: 'suggested',
      notes: '',
    },
    NOW,
  );
  h.deps.store.addEvent(
    { level: 'info', kind: 'award_suggested', message: `An award notice for “Park mowing” names ${winner} as the winner.`, opportunityId, applicationId, runId: null },
    NOW,
  );
}

describe('PUT /api/opportunities/:id/award (UX-11)', () => {
  it('validates the winner, amount and date', async () => {
    const h = await harness();
    const id = seedOpportunity(h.deps, { title: 'Park mowing' });
    expect((await put(h, id, { winner: '' })).statusCode).toBe(400);
    expect((await put(h, id, { winner: 'x'.repeat(201) })).statusCode).toBe(400);
    expect((await put(h, id, { winner: 'Blue Co', amount: -1 })).statusCode).toBe(400);
    const badDate = await put(h, id, { winner: 'Blue Co', awardedOn: 'July 2' });
    expect(badDate.statusCode).toBe(400);
    expect(badDate.json().error).toMatch(/2026-06-30/);
    expect((await put(h, 999, { winner: 'Blue Co' })).statusCode).toBe(404);
  });

  it('saves a confirmed, hand-typed award on any opportunity and shows it on the detail', async () => {
    const h = await harness();
    const id = seedOpportunity(h.deps, { title: 'Park mowing' });
    const res = await put(h, id, { winner: 'Blue Co', amount: 51_000, awardedOn: '2026-07-03', notes: 'Heard by phone.' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ opportunityId: id, winner: 'Blue Co', amount: 51_000, awardedOn: '2026-07-03', status: 'confirmed', origin: 'manual', notes: 'Heard by phone.' });
    const detail = (await h.app.inject({ method: 'GET', url: `/api/opportunities/${id}` })).json();
    expect(detail.award).toMatchObject({ winner: 'Blue Co', status: 'confirmed' });
  });

  it('keeps a suggestion unconfirmed until the PUT, then confirms it', async () => {
    const h = await harness();
    const id = seedOpportunity(h.deps, { title: 'Park mowing' });
    const app = createApp(h.deps, id, 'submitted');
    suggest(h, id, app.id, 'Blue Co');

    const before = (await h.app.inject({ method: 'GET', url: `/api/opportunities/${id}` })).json();
    expect(before.award).toMatchObject({ winner: 'Blue Co', status: 'suggested' });
    const appBefore = (await h.app.inject({ method: 'GET', url: `/api/applications/${app.id}` })).json();
    expect(appBefore.status).toBe('submitted');
    expect(appBefore.opportunity.award.status).toBe('suggested');
    expect(appBefore.resultSuggestion).toMatchObject({ outcome: 'lost', winner: 'Blue Co' });

    const res = await put(h, id, { winner: 'Blue Co', amount: 48_500, awardedOn: '2026-07-02' });
    expect(res.json()).toMatchObject({ status: 'confirmed', origin: 'parsed', amountText: '$48,500' });
    const appAfter = (await h.app.inject({ method: 'GET', url: `/api/applications/${app.id}` })).json();
    expect(appAfter.resultSuggestion).toBeNull();
    expect(appAfter.status).toBe('submitted');
  });

  it('marks an edited suggestion as typed in', async () => {
    const h = await harness();
    const id = seedOpportunity(h.deps, { title: 'Park mowing' });
    suggest(h, id, null, 'Blue Co');
    const res = await put(h, id, { winner: 'Blue Company Ltd', amount: 48_500 });
    expect(res.json()).toMatchObject({ origin: 'manual', status: 'confirmed', excerpt: '' });
  });

  it('suggests a win when the winner is your company', async () => {
    const h = await harness();
    h.deps.settings.setProfile({ ...h.deps.settings.getProfile(), legalName: 'Garry Oak Grounds Ltd.' });
    const id = seedOpportunity(h.deps, { title: 'Park mowing' });
    const app = createApp(h.deps, id, 'submitted');
    suggest(h, id, app.id, 'Garry Oak Grounds');
    const got = (await h.app.inject({ method: 'GET', url: `/api/applications/${app.id}` })).json();
    expect(got.resultSuggestion).toMatchObject({ outcome: 'won' });
  });
});

describe('DELETE /api/opportunities/:id/award', () => {
  it('removes the award (Ignore a suggestion)', async () => {
    const h = await harness();
    const id = seedOpportunity(h.deps, { title: 'Park mowing' });
    suggest(h, id, null, 'Blue Co');
    const res = await h.app.inject({ method: 'DELETE', url: `/api/opportunities/${id}/award` });
    expect(res.json()).toEqual({ ok: true });
    expect(h.deps.store.getAwardFor(id)).toBeUndefined();
    expect((await h.app.inject({ method: 'DELETE', url: '/api/opportunities/999/award' })).statusCode).toBe(404);
  });
});
