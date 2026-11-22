import { afterEach, describe, expect, it } from 'vitest';
import { sendDigest } from '../src/server/pipeline/notify.js';
import { at, closeHarnesses, createApp, harness, NOW, seedOpportunity } from './helpers/apiHarness.js';

afterEach(closeHarnesses);

async function setup(automation: Record<string, unknown>) {
  const h = await harness();
  h.deps.settings.setEmail({ host: 'smtp.example', port: 587, secure: false, user: 'u', pass: 'p', fromName: 'Office', fromEmail: 'office@co.example' });
  h.deps.settings.setAutomation({ ...h.deps.settings.getAutomation(), notifyEmail: 'me@co.example', ...automation });
  return h;
}

describe('summary e-mail (UX-3)', () => {
  it('still e-mails a closing reminder when new-bid e-mails are off', async () => {
    const h = await setup({ notifyOnNew: false });
    seedOpportunity(h.deps, { title: 'Fresh suitable bid' });
    const soon = seedOpportunity(h.deps, { title: 'Closing soon bid', closesAt: at(30) });
    createApp(h.deps, soon, 'ready');
    const run = h.deps.store.startRun('manual', NOW);
    expect(await sendDigest(h.deps, run)).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toContain('Closing soon and not yet submitted');
    expect(h.sent[0]!.text).not.toContain('New suitable opportunities');
  });

  it('sends nothing for reminders when closing reminders are off', async () => {
    const h = await setup({ notifyOnNew: false, notifyReminders: false });
    const soon = seedOpportunity(h.deps, { title: 'Closing soon bid', closesAt: at(30) });
    createApp(h.deps, soon, 'ready');
    expect(await sendDigest(h.deps, h.deps.store.startRun('manual', NOW))).toBe(false);
    expect(h.sent).toHaveLength(0);
  });

  it('adds "Open in Lgbids" links only when the app address is set', async () => {
    const without = await setup({});
    seedOpportunity(without.deps, { title: 'Park mowing' });
    await sendDigest(without.deps, without.deps.store.startRun('manual', NOW));
    expect(without.sent[0]!.text).not.toContain('Open in Lgbids');

    const withUrl = await setup({ appUrl: 'http://192.168.1.20:8080' });
    const id = seedOpportunity(withUrl.deps, { title: 'Park mowing' });
    await sendDigest(withUrl.deps, withUrl.deps.store.startRun('manual', NOW));
    expect(withUrl.sent[0]!.text).toContain(`Open in Lgbids: http://192.168.1.20:8080/opportunities/${id}`);
  });
});
