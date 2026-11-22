import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, openApp, test, waitForFirstRun, type DemoMailLine } from './support/demo.js';

// The find → qualify → prepare → send/upload → track path in demo mode.
// It runs against one demo server and one database, so the steps run in order.
// Never assert absolute dates: the demo's bids are dated relative to today.

test.skip(() => test.info().project.name !== 'demo', 'Needs the demo server and its mail sink.');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const MAIL_LOG = resolve('.e2e/mail-demo.jsonl');

interface AppRow {
  id: number;
  status: string;
  channel: string;
  missing: string[];
  opportunity: { title: string };
}

/** Ticks a saved checkbox; the page re-renders after the save, so wait for the state instead of trusting the click. */
async function tick(box: import('@playwright/test').Locator): Promise<void> {
  await box.click();
  await expect(box).toBeChecked();
}

async function applications(page: import('@playwright/test').Page): Promise<AppRow[]> {
  return (await (await page.request.get('/api/applications')).json()) as AppRow[];
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForFirstRun(page);
});

test('find: the Suitable view lists bids with score reasons', async ({ page, errors }) => {
  await openApp(page, '/opportunities');
  await page.getByRole('button', { name: /^Suitable/ }).click();
  const items = page.getByRole('main').getByRole('listitem').filter({ has: page.getByRole('button', { name: /Show why/ }) });
  await expect(items.first()).toBeVisible();
  await items.first().getByRole('button', { name: /Show why/ }).click();
  await expect(page.getByText(/In favour:/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('qualify: "Not for us" can be undone, and Pursue opens a draft', async ({ page }) => {
  await openApp(page, '/opportunities');
  await page.getByRole('button', { name: /^Review/ }).click();
  const notForUs = page.getByRole('button', { name: /^Not for us/ }).first();
  await expect(notForUs).toBeVisible();
  const label = (await notForUs.textContent()) ?? '';
  const title = label.replace(/^Not for us:\s*/, '').trim();
  await notForUs.click();
  await page.getByRole('button', { name: 'Undo' }).click();
  const pursue = page.getByRole('button', { name: `Pursue ${title}` });
  await expect(pursue).toBeVisible();
  await pursue.click();
  await expect.poll(async () => (await applications(page)).some((a) => a.opportunity.title === title)).toBe(true);
  const app = (await applications(page)).find((a) => a.opportunity.title === title)!;
  await openApp(page, `/applications/${app.id}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Price and letter' })).toBeVisible();
});

test('prepare and send: the price survives a quick tick, the e-mail carries the PDF, and a resend is refused', async ({ page }) => {
  const app = (await applications(page)).find((a) => a.channel === 'email' && a.status === 'needs_input');
  expect(app, 'an e-mail application waiting for input').toBeTruthy();
  await openApp(page, `/applications/${app!.id}`);

  await tick(page.getByRole('checkbox', { name: /I have read the bid documents/ }));
  // The v1 regression: a box ticked within the 1.5 s autosave delay lost the price.
  await page.getByRole('spinbutton', { name: /Total price/ }).fill('12500');
  await tick(page.getByRole('checkbox', { name: /Price entered and checked/ }));
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: /Total price/ })).toHaveValue('12500');

  const before = existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  await page.getByRole('button', { name: 'Send submission' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByRole('main').getByText(/^Submitted/).first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await applications(page)).find((a) => a.id === app!.id)?.status).toBe('submitted');

  await expect.poll(() => (existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0)).toBeGreaterThan(before);
  const lines = readFileSync(MAIL_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DemoMailLine);
  const anyPdf = lines
    .slice(before)
    .some((l) => l.attachments.some((f) => f.filename.endsWith('.pdf') && f.contentType === 'application/pdf' && f.size > 0));
  expect(anyPdf).toBe(true);

  const again = await page.request.post(`/api/applications/${app!.id}/send`, { data: {} });
  expect(again.status()).toBeGreaterThanOrEqual(400);
  await expect(page.getByRole('button', { name: 'Send submission' })).toHaveCount(0);
});

test('portal: the package is a PDF, then Mark as submitted, then Won', async ({ page }) => {
  const app = (await applications(page)).find((a) => a.channel === 'portal' && a.status === 'needs_input' && a.missing.length === 1);
  expect(app, 'a portal application with one item missing').toBeTruthy();
  await openApp(page, `/applications/${app!.id}`);
  await tick(page.getByRole('checkbox', { name: /I have read the bid documents/ }));
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible({ timeout: 10_000 });

  const link = page.getByRole('link', { name: 'Download package' }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  const pkg = await page.request.get(href!);
  expect(pkg.ok()).toBe(true);
  expect((await pkg.body()).subarray(0, 4).toString('latin1')).toBe('%PDF');

  await page.getByRole('button', { name: 'Mark as submitted' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Mark as submitted' });
  await dialog.getByLabel('Where or how did you submit it?').fill('Buyer portal');
  await dialog.getByRole('button', { name: 'Mark as submitted' }).click();
  await expect(page.getByRole('button', { name: /Won/ })).toBeVisible();
  await page.getByRole('button', { name: /Won/ }).click();
  // UX-11: "Won" opens a dialog that also asks who won and at what price.
  const result = page.getByRole('dialog', { name: 'Record a win' });
  await result.getByRole('button', { name: 'Save result' }).click();
  await expect(page.getByText('Recorded as won. Congratulations.')).toBeVisible();
});

test('track: states show in the list, the calendar has an event and the CSV has a BOM', async ({ page }) => {
  await openApp(page, '/applications');
  const stages = page.getByRole('navigation', { name: 'Application stages' });
  await expect(stages.getByRole('link', { name: /Submitted/ })).not.toHaveText(/^0 /);
  await expect(stages.getByRole('link', { name: /Finished/ })).not.toHaveText(/^0 /);

  const ics = await (await page.request.get('/api/calendar.ics')).text();
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('BEGIN:VEVENT');
  const csv = await (await page.request.get('/api/opportunities.csv?view=all')).body();
  expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
});

test('guardrail: fully automatic mode is not offered', async ({ page }) => {
  await openApp(page, '/settings');
  await expect(page.getByRole('radio', { name: /draft applications for my approval/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /without my review|send(s)? .*automatic/i })).toHaveCount(0);
  await expect(page.getByText('Also sends complete e-mail submissions')).toHaveCount(0);
});
