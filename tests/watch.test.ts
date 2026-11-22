import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/server/contracts.js';
import { sendDigest } from '../src/server/pipeline/notify.js';
import { notifyChanges } from '../src/server/pipeline/watch.js';
import type { NoticeChangeKind } from '../src/shared/schemas.js';
import { closeHarnesses, createApp, harness, NOW, seedOpportunity, type Harness } from './helpers/apiHarness.js';

afterEach(closeHarnesses);

function fakeFetch(): FetchLike & { bodies: string[] } {
  const bodies: string[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body ?? ''));
    return Response.json({ id: 'x' });
  }) as FetchLike & { bodies: string[] };
  fn.bodies = bodies;
  return fn;
}

async function setup(opts: { email?: boolean; notifyChanges?: boolean } = {}) {
  const fetch = fakeFetch();
  const h = await harness({}, undefined, { pushFetch: fetch });
  h.deps.settings.setPush({ provider: 'ntfy', ntfyServer: 'https://ntfy.example', ntfyTopic: 'lgbids-x7Kq92mPz' });
  if (opts.email) {
    h.deps.settings.setEmail({ host: 'smtp.example', port: 587, secure: false, user: 'u', pass: 'p', fromName: 'Office', fromEmail: 'office@co.example' });
    h.deps.settings.setAutomation({ ...h.deps.settings.getAutomation(), notifyEmail: 'me@co.example', notifyChanges: opts.notifyChanges ?? true });
  }
  return { h, pushes: fetch.bodies };
}

function change(h: Harness, opportunityId: number, kind: NoticeChangeKind = 'closing_moved', runId: number | null = null) {
  return h.deps.store.addChange({
    opportunityId,
    kind,
    summary: kind === 'closing_refined' ? 'The closing time is now 2:00 PM.' : 'The closing date moved from 25 June to 2 July.',
    before: '2026-06-25T21:00:00Z',
    after: '2026-07-02T21:00:00Z',
    addendum: false,
    detectedAt: NOW.toISOString(),
    runId,
  });
}

function pursued(h: Harness, title: string): number {
  const id = seedOpportunity(h.deps, { title });
  h.deps.store.setUserDecision(id, 'pursue');
  return id;
}

describe('change alerts (MAT-10)', () => {
  it('sends one push per change and never repeats it', async () => {
    const { h, pushes } = await setup();
    const id = pursued(h, 'Park mowing');
    change(h, id);
    expect(await notifyChanges(h.deps, NOW)).toEqual({ sent: 1, skipped: 0 });
    expect(await notifyChanges(h.deps, NOW)).toEqual({ sent: 0, skipped: 0 });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toContain('Park mowing — District of Saanich: The closing date moved from 25 June to 2 July.');
    expect(h.deps.store.listChanges(id)[0]!.notifiedAt).not.toBeNull();
  });

  it('keeps a refinement silent', async () => {
    const { h, pushes } = await setup();
    const id = pursued(h, 'Park mowing');
    change(h, id, 'closing_refined');
    expect(await notifyChanges(h.deps, NOW)).toEqual({ sent: 0, skipped: 1 });
    expect(pushes).toHaveLength(0);
    expect(h.deps.store.unnotifiedChanges()).toHaveLength(0);
  });

  it('records a change on a muted or unwatched bid without alerting', async () => {
    const { h, pushes } = await setup();
    const muted = pursued(h, 'Muted bid');
    h.deps.store.setAlertsMuted(muted, true);
    const unwatched = seedOpportunity(h.deps, { title: 'Just listed' });
    change(h, muted);
    change(h, unwatched);
    expect(await notifyChanges(h.deps, NOW)).toEqual({ sent: 0, skipped: 2 });
    expect(pushes).toHaveLength(0);
    expect(h.deps.store.listChanges(muted)).toHaveLength(1);
  });

  it('watches a bid with a submitted application, and e-mails only when the switch is on', async () => {
    const on = await setup({ email: true });
    const id = seedOpportunity(on.h.deps, { title: 'Sent bid' });
    const app = createApp(on.h.deps, id, 'ready');
    on.h.deps.store.updateApplication(app.id, { status: 'submitted' }, NOW);
    change(on.h, id);
    expect((await notifyChanges(on.h.deps, NOW)).sent).toBe(1);
    expect(on.h.sent.map((m) => m.subject)).toEqual(['Lgbids: Changed: Sent bid']);

    const off = await setup({ email: true, notifyChanges: false });
    const other = pursued(off.h, 'Quiet bid');
    change(off.h, other);
    expect((await notifyChanges(off.h.deps, NOW)).sent).toBe(1);
    expect(off.h.sent).toHaveLength(0);
    expect(off.pushes).toHaveLength(1);
  });

  it('never throws when the push fails, and tries again later', async () => {
    const h = await harness({}, undefined, {
      pushFetch: (async () => {
        throw new TypeError('fetch failed');
      }) as FetchLike,
    });
    h.deps.settings.setPush({ provider: 'ntfy', ntfyServer: 'https://ntfy.example', ntfyTopic: 'lgbids-x7Kq92mPz' });
    const id = pursued(h, 'Park mowing');
    change(h, id);
    await expect(notifyChanges(h.deps, NOW)).resolves.toEqual({ sent: 0, skipped: 0 });
    expect(h.deps.store.unnotifiedChanges()).toHaveLength(1);
    expect(h.deps.store.listEvents(10).some((e) => e.level === 'warn' && e.message.startsWith('The change alert through ntfy could not be sent.'))).toBe(true);
  });

  it('lists changes first in the summary e-mail instead of re-listing the bid as new', async () => {
    const { h } = await setup({ email: true });
    const run = h.deps.store.startRun('manual', NOW);
    const id = pursued(h, 'Changed bid');
    seedOpportunity(h.deps, { title: 'Brand new bid' });
    change(h, id, 'closing_moved', run.id);
    expect(await sendDigest(h.deps, run)).toBe(true);
    const digest = h.sent.find((m) => m.subject.startsWith('Lgbids: 1 change'))!;
    expect(digest.subject).toBe('Lgbids: 1 change to a bid you are pursuing, 1 new opportunity');
    const text = digest.text;
    expect(text.indexOf('Changes to bids you are pursuing')).toBeLessThan(text.indexOf('New suitable opportunities'));
    expect(text.split('Changed bid')).toHaveLength(2);
    expect(text).not.toContain('Closing soon');
  });
});

describe('POST /api/opportunities/:id/changes/seen (MAT-15)', () => {
  it('marks every change as seen and answers 404 for an unknown bid', async () => {
    const { h } = await setup();
    const id = pursued(h, 'Park mowing');
    change(h, id);
    change(h, id, 'closing_refined');
    const before = (await h.app.inject({ method: 'GET', url: `/api/opportunities/${id}` })).json();
    expect(before.unseenChanges).toBe(1);
    expect(before.changes).toHaveLength(2);
    const seen = await h.app.inject({ method: 'POST', url: `/api/opportunities/${id}/changes/seen` });
    expect(seen.statusCode).toBe(200);
    expect(seen.json().unseenChanges).toBe(0);
    expect(seen.json().changes.every((c: { seenAt: string | null }) => c.seenAt !== null)).toBe(true);
    expect((await h.app.inject({ method: 'POST', url: '/api/opportunities/9999/changes/seen' })).statusCode).toBe(404);
  });
});
