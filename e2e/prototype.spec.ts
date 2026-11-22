import { expect, test } from './support/demo.js';
import type { Page } from '@playwright/test';

// The hosted beta prototype (dist/prototype, or the live site when PROTOTYPE_URL
// is set). With PROTOTYPE_URL only read-only checks run: nothing changes the
// saved state and the feedback form is never submitted.

test.skip(() => test.info().project.name !== 'prototype', 'Checks the static prototype build.');
const live = Boolean(process.env.PROTOTYPE_URL);

const ROUTES = [
  '/',
  '/opportunities',
  '/opportunities/101',
  '/applications',
  '/applications/201',
  '/profile',
  '/documents',
  '/insights',
  '/sources',
  '/settings',
  '/activity',
  '/help',
  '/no-such-page',
];

async function allCount(page: Page): Promise<number> {
  await page.goto('/opportunities');
  const all = page.getByRole('navigation', { name: 'Filter opportunities' }).getByRole('button', { name: /^All/ });
  await expect(all).toHaveText(/\d+/);
  return Number(/(\d+)/.exec((await all.textContent()) ?? '')![1]);
}

/**
 * Reads a file the prototype builds in the browser. Downloads and new-tab PDFs
 * both go through URL.createObjectURL, so the test keeps each blob it is given.
 */
async function download(page: Page, open: () => Promise<void>): Promise<Buffer> {
  const seen = await page.evaluate(() => (window as unknown as { __blobs: Blob[] }).__blobs.length);
  await open();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __blobs: Blob[] }).__blobs.length)).toBeGreaterThan(seen);
  const bytes = await page.evaluate(async (i) => {
    const blob = (window as unknown as { __blobs: Blob[] }).__blobs[i]!;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, seen);
  return Buffer.from(bytes);
}

for (const width of [1280, 390]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`every route at ${width}px, ${scheme}: no errors, one h1, no sideways scroll`, async ({ page, errors }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.getByRole('main'), route).toBeAttached();
        await expect(page.locator('h1'), route).toHaveCount(1);
        // Lazy pages show a skeleton first; wait for the real heading text.
        await expect(page.locator('h1'), route).not.toHaveText('');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${route} scrolls sideways`).toBeLessThanOrEqual(1);
      }
      expect(errors).toEqual([]);
    });
  }
}

test('"Run now" adds exactly one sample bid and a reload keeps it', async ({ page }) => {
  test.skip(live, 'Changes the saved state.');
  const before = await allCount(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Run now' }).click();
  // The sample check finishes after about five seconds inside the page, so stay on it until then.
  await page.waitForTimeout(6_500);
  expect(await allCount(page)).toBe(before + 1);
  await page.reload();
  expect(await allCount(page)).toBe(before + 1);
});

test('downloads: the package is a PDF, the calendar and the CSV are valid', async ({ page, context }) => {
  await page.addInitScript(() => {
    const keep: Blob[] = [];
    (window as unknown as { __blobs: Blob[] }).__blobs = keep;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob) keep.push(obj);
      return create(obj);
    };
  });
  // A new-tab PDF has nothing to show headless; close such tabs straight away.
  context.on('page', (tab) => void tab.close().catch(() => undefined));
  await page.goto('/applications/201');
  const pkg = page.getByRole('link', { name: /Download package|Preview package/ }).first();
  await expect(pkg).toBeVisible();
  const pdf = await download(page, () => pkg.click());
  expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');

  await page.goto('/');
  const ics = (await download(page, () => page.getByRole('link', { name: 'Add to calendar' }).first().click())).toString('utf8');
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('BEGIN:VEVENT');
  expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);

  await page.goto('/opportunities');
  const csv = await download(page, () => page.getByRole('link', { name: 'Download CSV' }).click());
  expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(csv.toString('utf8').split(/\r?\n/)[0]).toContain(',');
});

test('the static feedback form is a Netlify form', async ({ request }) => {
  const res = await request.get('/feedback.html');
  expect(res.ok()).toBe(true);
  const html = await res.text();
  expect(html).toMatch(/<form[^>]*name="beta-feedback"[^>]*data-netlify="true"/);
});
