import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/server/contracts.js';
import { dueThreshold, runReminders } from '../src/server/pipeline/reminders.js';
import { closeHarnesses, createApp, harness, HOUR, seedOpportunity } from './helpers/apiHarness.js';

afterEach(closeHarnesses);

interface Clocked {
  clock: { now: Date };
  pushes: string[];
}

function fakeFetch(fail = false): FetchLike & { bodies: string[] } {
  const bodies: string[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    if (fail) throw new TypeError('fetch failed');
    bodies.push(String(init.body ?? ''));
    return Response.json({ id: 'x' });
  }) as FetchLike & { bodies: string[] };
  fn.bodies = bodies;
  return fn;
}

async function setup(opts: { failPush?: boolean; email?: boolean } = {}) {
  const clock = { now: new Date('2026-06-15T20:00:00Z') };
  const fetch = fakeFetch(opts.failPush);
  const h = await harness({}, undefined, { now: () => clock.now, pushFetch: fetch });
  h.deps.settings.setPush({ provider: 'ntfy', ntfyServer: 'https://ntfy.example', ntfyTopic: 'lgbids-x7Kq92mPz' });
  if (opts.email) {
    h.deps.settings.setEmail({ host: 'smtp.example', port: 587, secure: false, user: 'u', pass: 'p', fromName: 'Office', fromEmail: 'office@co.example' });
    h.deps.settings.setAutomation({ ...h.deps.settings.getAutomation(), notifyEmail: 'me@co.example' });
  }
  const ctx: Clocked = { clock, pushes: fetch.bodies };
  return { h, ...ctx };
}

const before = (closesAt: string, hours: number) => new Date(new Date(closesAt).getTime() - hours * HOUR);

describe('dueThreshold', () => {
  const deadline = new Date('2026-06-20T21:00:00Z');
  it('picks the nearest open threshold and nothing after the deadline', () => {
    expect(dueThreshold([72, 24], deadline, before(deadline.toISOString(), 80))).toBeNull();
    expect(dueThreshold([72, 24], deadline, before(deadline.toISOString(), 72))).toBe(72);
    expect(dueThreshold([72, 24], deadline, before(deadline.toISOString(), 20))).toBe(24);
    expect(dueThreshold([72, 24], deadline, deadline)).toBeNull();
  });
});

describe('closing reminders (UX-7)', () => {
  for (const [season, closesAt] of [
    ['June', '2026-06-25T21:00:00Z'],
    ['December', '2026-12-10T22:00:00Z'],
  ] as const) {
    it(`sends the 72 h and then the 24 h reminder once each (${season})`, async () => {
      const { h, clock, pushes } = await setup();
      const id = seedOpportunity(h.deps, { title: 'Park mowing', closesAt });
      h.deps.store.setUserDecision(id, 'pursue');
      const tick = async (hoursBefore: number) => {
        clock.now = before(closesAt, hoursBefore);
        return runReminders(h.deps, clock.now);
      };
      expect((await tick(80)).sent).toBe(0);
      expect((await tick(71)).sent).toBe(1);
      expect((await tick(70)).sent).toBe(0);
      expect((await tick(30)).sent).toBe(0);
      expect((await tick(23)).sent).toBe(1);
      expect((await tick(1)).sent).toBe(0);
      expect(pushes).toHaveLength(2);
      expect(pushes[0]).toContain('Closes in 72 hours: Park mowing — District of Saanich');
      expect(pushes[1]).toContain('Closes in 24 hours: Park mowing');
      expect(h.deps.store.listReminders(id).map((r) => r.thresholdHours)).toEqual([72, 24]);
      expect(h.deps.store.listEvents(20).filter((e) => e.kind === 'reminder_sent')).toHaveLength(2);
    });
  }

  it('sends only the 24 h reminder for a bid pursued 20 h before closing', async () => {
    const { h, clock, pushes } = await setup();
    const closesAt = '2026-06-25T21:00:00Z';
    const id = seedOpportunity(h.deps, { title: 'Late pursuit', closesAt });
    h.deps.store.setUserDecision(id, 'pursue');
    clock.now = before(closesAt, 20);
    expect((await runReminders(h.deps, clock.now)).sent).toBe(1);
    clock.now = before(closesAt, 19);
    expect((await runReminders(h.deps, clock.now)).sent).toBe(0);
    expect(pushes).toHaveLength(1);
    expect(h.deps.store.listReminders(id).map((r) => r.thresholdHours)).toEqual([24]);
  });

  it('counts a date-only closing from the start of that day', async () => {
    const { h, clock } = await setup();
    // Stored as the end of 24 June local time; sending must be done by the start of it.
    const closesAt = '2026-06-25T06:59:59Z';
    const id = seedOpportunity(h.deps, { title: 'Hedges', closesAt, precision: 'date' });
    h.deps.store.setUserDecision(id, 'pursue');
    clock.now = new Date('2026-06-23T08:30:00Z'); // 22.5 h before 24 June 00:00 local
    expect((await runReminders(h.deps, clock.now)).sent).toBe(1);
    expect(h.deps.store.listReminders(id).map((r) => r.thresholdHours)).toEqual([24]);
    clock.now = new Date('2026-06-24T08:00:00Z'); // past the start of the day: nothing more
    expect((await runReminders(h.deps, clock.now)).sent).toBe(0);
  });

  it('sends nothing for a muted bid', async () => {
    const { h, clock, pushes } = await setup();
    const closesAt = '2026-06-25T21:00:00Z';
    const id = seedOpportunity(h.deps, { title: 'Muted', closesAt });
    h.deps.store.setUserDecision(id, 'pursue');
    h.deps.store.setAlertsMuted(id, true);
    clock.now = before(closesAt, 23);
    expect((await runReminders(h.deps, clock.now)).sent).toBe(0);
    expect(pushes).toHaveLength(0);
  });

  it('re-arms the reminders when the closing date moves', async () => {
    const { h, clock, pushes } = await setup();
    const first = '2026-06-25T21:00:00Z';
    const id = seedOpportunity(h.deps, { title: 'Moved', closesAt: first });
    h.deps.store.setUserDecision(id, 'pursue');
    clock.now = before(first, 23);
    expect((await runReminders(h.deps, clock.now)).sent).toBe(1);
    const moved = '2026-06-27T21:00:00Z';
    seedOpportunity(h.deps, { title: 'Moved', closesAt: moved });
    clock.now = before(moved, 23);
    expect((await runReminders(h.deps, clock.now)).sent).toBe(1);
    expect(pushes).toHaveLength(2);
    expect(h.deps.store.listReminders(id).map((r) => r.closesAt)).toEqual([first, moved]);
  });

  it('sends nothing for a submitted bid, and says what an unsent one still needs', async () => {
    const { h, clock, pushes } = await setup();
    const closesAt = '2026-06-25T21:00:00Z';
    const sent = seedOpportunity(h.deps, { title: 'Already sent', closesAt });
    h.deps.store.setUserDecision(sent, 'pursue');
    const app = createApp(h.deps, sent, 'ready');
    h.deps.store.updateApplication(app.id, { status: 'submitted' }, clock.now);
    const open = seedOpportunity(h.deps, { title: 'Needs a price', closesAt });
    const draft = createApp(h.deps, open, 'needs_input');
    h.deps.store.updateApplication(draft.id, { missing: ['A price.'] }, clock.now);
    clock.now = before(closesAt, 23);
    expect((await runReminders(h.deps, clock.now)).sent).toBe(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toContain('Needs a price');
    expect(pushes[0]).toContain('Still needs: a price.');
    expect(h.deps.store.listReminders(sent)).toHaveLength(0);
  });

  it('still e-mails the reminder when the phone alert fails, and never throws', async () => {
    const { h, clock } = await setup({ failPush: true, email: true });
    const closesAt = '2026-06-25T21:00:00Z';
    const id = seedOpportunity(h.deps, { title: 'Ready bid', closesAt });
    createApp(h.deps, id, 'ready');
    clock.now = before(closesAt, 23);
    await expect(runReminders(h.deps, clock.now)).resolves.toEqual({ sent: 1, failed: 0 });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.subject).toBe('Lgbids: Closes in 24 hours: Ready bid');
    expect(h.sent[0]!.text).toContain('Ready to send.');
    expect(h.deps.store.listReminders(id)[0]!.channels).toEqual(['email']);
    expect(h.deps.store.listEvents(20).some((e) => e.level === 'warn' && e.message.startsWith('The closing reminder through ntfy could not be sent.'))).toBe(true);
  });

  it('retries on the next tick when no channel went through', async () => {
    const { h, clock } = await setup({ failPush: true });
    const closesAt = '2026-06-25T21:00:00Z';
    const id = seedOpportunity(h.deps, { title: 'Unlucky', closesAt });
    h.deps.store.setUserDecision(id, 'pursue');
    clock.now = before(closesAt, 23);
    expect(await runReminders(h.deps, clock.now)).toEqual({ sent: 0, failed: 1 });
    expect(h.deps.store.listReminders(id)).toHaveLength(0);
  });
});

describe('POST /api/opportunities/:id/alerts', () => {
  it('mutes and unmutes a bid, and answers 404 for an unknown one', async () => {
    const { h } = await setup();
    const id = seedOpportunity(h.deps, { title: 'Park mowing' });
    const muted = await h.app.inject({ method: 'POST', url: `/api/opportunities/${id}/alerts`, payload: { muted: true } });
    expect(muted.statusCode).toBe(200);
    expect(muted.json()).toMatchObject({ id, alertsMuted: true, changes: [] });
    const unmuted = await h.app.inject({ method: 'POST', url: `/api/opportunities/${id}/alerts`, payload: { muted: false } });
    expect(unmuted.json().alertsMuted).toBe(false);
    expect((await h.app.inject({ method: 'POST', url: '/api/opportunities/9999/alerts', payload: { muted: true } })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: `/api/opportunities/${id}/alerts`, payload: { muted: 'yes' } })).statusCode).toBe(400);
  });
});
