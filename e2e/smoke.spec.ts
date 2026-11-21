import { expect, openApp, test } from './support/demo.js';

// Runs in both projects: `demo` (npm run demo) and `prototype` (dist/prototype
// served with its Netlify headers).

test('opens on Today with the main menu and no errors', async ({ page, errors }) => {
  await openApp(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  // Demo and prototype both say plainly that the data is invented.
  await expect(page.locator('.demo-tag')).toHaveText(test.info().project.name === 'prototype' ? 'Beta' : 'Demo');
  expect(errors).toEqual([]);
});

test('loads the single-page app on a client route', async ({ page, errors }) => {
  const res = await page.goto('/opportunities');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test('sends the security headers', async ({ page }) => {
  const res = await page.goto('/');
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
});
