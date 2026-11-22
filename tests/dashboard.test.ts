import { afterEach, describe, expect, it } from 'vitest';
import type { DashboardResponse } from '../src/shared/api.js';
import type { FetchLike } from '../src/server/contracts.js';
import { LAYOUT_WARNING_FOOTNOTE, layoutWarningBody, layoutWarningTitle } from '../src/server/sources/health.js';
import { at, closeHarnesses, createApp, harness, NOW, SOURCE_ID, seedOpportunity } from './helpers/apiHarness.js';

afterEach(closeHarnesses);

async function dashboard(h: Awaited<ReturnType<typeof harness>>): Promise<DashboardResponse> {
  return (await h.app.inject({ method: 'GET', url: '/api/dashboard' })).json() as DashboardResponse;
}

describe('dashboard setup (UX-1)', () => {
  it('lists the phone step as optional, last, linking to Settings', async () => {
    const h = await harness();
    const d = await dashboard(h);
    expect(d.setup.map((s) => s.key)).toEqual(['profile', 'alerts', 'services', 'email', 'documents', 'run', 'push']);
    const push = d.setup.find((s) => s.key === 'push')!;
    expect(push).toMatchObject({ optional: true, done: false, href: '/settings#push', label: 'Get alerts on your phone (optional)' });
    expect(d.setup.find((s) => s.key === 'email')!.href).toBe('/settings#email');
    expect(d.setup.filter((s) => s.optional)).toHaveLength(1);
  });

  it('marks the phone step done after a successful test alert', async () => {
    const fetch = (async () => Response.json({ ok: true, result: {} })) as unknown as FetchLike;
    const h = await harness({}, undefined, { pushFetch: fetch });
    await h.app.inject({ method: 'PUT', url: '/api/settings/push', payload: { provider: 'ntfy', ntfyServer: 'https://ntfy.example', ntfyTopic: 'lgbids-x7Kq92mPz' } });
    const test = await h.app.inject({ method: 'POST', url: '/api/settings/push/test' });
    expect(test.statusCode).toBe(200);
    expect((await dashboard(h)).setup.find((s) => s.key === 'push')!.done).toBe(true);
  });
});

describe('dashboard counts (UX-2)', () => {
  it('counts warned sources and bids awaiting a result', async () => {
    const h = await harness();
    h.deps.store.recordSourceRun(SOURCE_ID, { status: 'ok', message: '', itemCount: 6 }, NOW);
    h.deps.store.recordSourceRun(SOURCE_ID, { status: 'empty', message: '', itemCount: 0 }, NOW);
    const old = seedOpportunity(h.deps, { title: 'Old bid', closesAt: at(-24 * 20) });
    const recent = seedOpportunity(h.deps, { title: 'Recent bid', closesAt: at(-24 * 3) });
    createApp(h.deps, old, 'submitted');
    createApp(h.deps, recent, 'submitted');
    const d = await dashboard(h);
    expect(d.counts.sourcesWarning).toBe(1);
    expect(d.counts.awaitingResult).toBe(1);
    expect(d.counts.submitted).toBe(2);
  });
});

describe('layout warning text (UX-2)', () => {
  it('uses the plain v2 wording', () => {
    expect(layoutWarningTitle('Esquimalt')).toBe('Esquimalt listed no bids this time');
    expect(layoutWarningBody(4)).toBe(
      'Last time it listed 4. The site may have changed how it shows bids, so Lgbids could be missing some. Open the site and look for open bids, then press Test.',
    );
    expect(LAYOUT_WARNING_FOOTNOTE).toBe('If the site has nothing open right now, this goes away when bids are listed again.');
  });
});
