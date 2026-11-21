import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared e2e fixtures for both projects (demo server and static prototype).
 * `errors` collects console errors and uncaught page errors, which is where a
 * CSP violation or a broken lazy chunk shows up.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    await use(errors);
  },
});

export { expect };

/** Opens a route and waits for the app shell (main menu and the page heading). */
export async function openApp(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
