import { afterEach, describe, expect, it } from 'vitest';
import { parseCorpus } from '../src/server/matching/evaluate.js';
import type { FeedbackRecord, Opportunity } from '../src/shared/schemas.js';
import { closeHarnesses, createApp, harness, seedOpportunity } from './helpers/apiHarness.js';

afterEach(closeHarnesses);

async function setup() {
  const h = await harness();
  h.deps.settings.setProfile({ ...h.deps.settings.getProfile(), companyName: 'Secret Gardens Ltd', email: 'owner@secret.example', phone: '250-555-0199' });
  const id = seedOpportunity(h.deps, { title: 'Park mowing 2026' });
  return { h, id };
}

describe('feedback API (MAT-12)', () => {
  it('saves not-relevant feedback with a snapshot and dismisses the bid', async () => {
    const { h, id } = await setup();
    const app = createApp(h.deps, id, 'ready');
    const res = await h.app.inject({ method: 'PUT', url: `/api/opportunities/${id}/feedback`, payload: { verdict: 'not_relevant', reasons: ['supply_only'], note: 'Seed only.' } });
    expect(res.statusCode).toBe(200);
    const fb = res.json<FeedbackRecord>();
    expect(fb).toMatchObject({ opportunityId: id, verdict: 'not_relevant', reasons: ['supply_only'], note: 'Seed only.', score: 80, decision: 'suitable', matchedTerms: ['mowing'], services: ['lawn'], area: 'yes', areaMatch: 'Saanich', sourceId: 'test-source', noticeType: 'RFQ' });
    expect(h.deps.store.getOpportunity(id)!.userDecision).toBe('dismissed');
    expect(h.deps.store.getApplication(app.id)!.status).toBe('withdrawn');
    const detail = (await h.app.inject({ url: `/api/opportunities/${id}` })).json<Opportunity>();
    expect(detail.myFeedback?.id).toBe(fb.id);
  });

  it('replaces the one record per bid, and undo removes it and brings the bid back', async () => {
    const { h, id } = await setup();
    await h.app.inject({ method: 'PUT', url: `/api/opportunities/${id}/feedback`, payload: { verdict: 'missed', reasons: ['our_work'] } });
    expect(h.deps.store.getOpportunity(id)!.userDecision).toBeNull();
    await h.app.inject({ method: 'PUT', url: `/api/opportunities/${id}/feedback`, payload: { verdict: 'not_relevant', reasons: [] } });
    const list = (await h.app.inject({ url: '/api/feedback' })).json<FeedbackRecord[]>();
    expect(list).toHaveLength(1);
    expect(list[0]!.verdict).toBe('not_relevant');
    const del = await h.app.inject({ method: 'DELETE', url: `/api/opportunities/${id}/feedback` });
    expect(del.json()).toEqual({ ok: true });
    expect((await h.app.inject({ url: '/api/feedback' })).json()).toEqual([]);
    expect(h.deps.store.getOpportunity(id)!.userDecision).toBeNull();
  });

  it('answers bad input and unknown bids with full sentences', async () => {
    const { h, id } = await setup();
    const bad = await h.app.inject({ method: 'PUT', url: `/api/opportunities/${id}/feedback`, payload: { verdict: 'meh', reasons: ['nope'] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/\.$/);
    const missing = await h.app.inject({ method: 'PUT', url: '/api/opportunities/9999/feedback', payload: { verdict: 'missed' } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toMatch(/could not be found\..*\.$/);
    expect((await h.app.inject({ method: 'DELETE', url: '/api/opportunities/9999/feedback' })).statusCode).toBe(404);
    const short = await h.app.inject({ method: 'POST', url: '/api/feedback/missed', payload: { title: 'x' } });
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toMatch(/\.$/);
  });

  it('scores a reported missed bid and keeps the trace', async () => {
    const { h } = await setup();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/feedback/missed',
      payload: { title: 'Boulevard tree pruning, Esquimalt', organization: 'Township of Esquimalt', foundVia: 'BC Bid', url: 'https://bids.example/77', text: 'Pruning of boulevard trees.' },
    });
    expect(res.statusCode).toBe(200);
    const fb = res.json<FeedbackRecord>();
    expect(fb).toMatchObject({ opportunityId: null, verdict: 'missed', foundVia: 'BC Bid', sourceId: '' });
    expect(fb.trace?.matches.length).toBeGreaterThan(0);
    expect(fb.lexiconVersion).not.toBe('');
  });

  it('exports CSV with a BOM and formula guard, and corpus rows without profile fields', async () => {
    const { h, id } = await setup();
    await h.app.inject({ method: 'PUT', url: `/api/opportunities/${id}/feedback`, payload: { verdict: 'not_relevant', reasons: ['other'], note: '=HYPERLINK("x")' } });
    await h.app.inject({ method: 'POST', url: '/api/feedback/missed', payload: { title: 'Hedge trimming at the library', organization: 'Town', note: 'Private note' } });
    const csv = await h.app.inject({ url: '/api/feedback.csv' });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/lgbids-feedback-2026-06-15\.csv/);
    expect(csv.body.startsWith('﻿Date,Verdict')).toBe(true);
    expect(csv.body).toContain(`"'=HYPERLINK(""x"")"`);

    const jsonl = await h.app.inject({ url: '/api/feedback/corpus.jsonl' });
    expect(jsonl.headers['content-type']).toMatch(/ndjson/);
    const rows = parseCorpus(jsonl.body);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.origin === 'beta')).toBe(true);
    expect(rows.find((r) => r.title === 'Park mowing 2026')!.expected).toMatchObject({ relevant: false, decision: 'unsuitable' });
    expect(rows.find((r) => r.title.startsWith('Hedge'))!.expected).toMatchObject({ relevant: true, decision: 'suitable' });
    for (const secret of ['Secret Gardens', 'owner@secret.example', '250-555-0199', 'Private note', 'HYPERLINK']) expect(jsonl.body).not.toContain(secret);
  });
});

describe('prototype mock parity (UX-9)', async () => {
  // Loaded by a computed path: the mock's types pull in browser globals that the server tsconfig does not know.
  type Res = { status: number; body: unknown };
  type Ctx = { state: { opportunities: Opportunity[]; v2: { feedback: FeedbackRecord[] } }; newId(): number; updateApp(): Res; recompute(a: unknown): unknown };
  type Mock = (ctx: Ctx, req: { method: string; path: string; q: URLSearchParams; body: Record<string, unknown>; rawBody: unknown }) => Res | null;
  const modulePath = ['..', 'src', 'web', 'mock', 'feedback.js'].join('/');
  const { feedback: mock } = (await import(/* @vite-ignore */ modulePath)) as { feedback: Mock };

  it('answers like the server: snapshot, dismissal, undo and the same 404 sentence', async () => {
    const { h, id } = await setup();
    const opp = (await h.app.inject({ url: `/api/opportunities/${id}` })).json<Opportunity>();
    let next = 100;
    const state = { opportunities: [{ ...opp }], applications: [], sources: [], v2: { changes: [], feedback: [], awards: [], savedSearches: [], recipients: [] } };
    const ctx: Ctx = { state, newId: () => next++, updateApp: () => ({ status: 200, body: null }), recompute: (a) => a };
    const call = (method: string, path: string, body: Record<string, unknown> = {}) => mock(ctx, { method, path, q: new URLSearchParams(), body, rawBody: body });

    const saved = (await call('PUT', `/api/opportunities/${id}/feedback`, { verdict: 'not_relevant', reasons: ['other'] }))!;
    const server = (await h.app.inject({ method: 'PUT', url: `/api/opportunities/${id}/feedback`, payload: { verdict: 'not_relevant', reasons: ['other'] } })).json<FeedbackRecord>();
    const pick = (f: FeedbackRecord) => ({ verdict: f.verdict, reasons: f.reasons, title: f.title, score: f.score, decision: f.decision, matchedTerms: f.matchedTerms, area: f.area, sourceId: f.sourceId });
    expect(pick(saved.body as FeedbackRecord)).toEqual(pick(server));
    expect(state.opportunities[0]!.userDecision).toBe('dismissed');
    await call('DELETE', `/api/opportunities/${id}/feedback`);
    expect(state.v2.feedback).toEqual([]);
    expect(state.opportunities[0]!.userDecision).toBeNull();

    const missing = (await call('PUT', '/api/opportunities/9999/feedback', { verdict: 'missed' }))!;
    const serverMissing = await h.app.inject({ method: 'PUT', url: '/api/opportunities/9999/feedback', payload: { verdict: 'missed' } });
    expect(missing.status).toBe(404);
    expect((missing.body as { error: string }).error).toBe(serverMissing.json().error);
    expect((await call('PUT', `/api/opportunities/${id}/feedback`, { verdict: 'meh' }))!.status).toBe(400);
    expect((await call('GET', '/api/insights/scoring'))!.status).toBe(200);
  });
});
