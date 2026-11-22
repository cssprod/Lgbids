import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openApp, test } from './support/demo.js';

// Accessibility (TST-5): axe on every route, an open dialog and the phone menu,
// in light and dark at desktop and phone widths, in both projects. axe-core
// comes from npm, so nothing is fetched from a CDN. The baseline is zero
// serious or critical issues; minor and moderate ones are reported, not failed.

// @axe-core/playwright types its page against its own copy of playwright-core,
// which can be a different minor version from @playwright/test's; the runtime object is the same.
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];
const STATIC_ROUTES = ['/', '/opportunities', '/applications', '/profile', '/documents', '/insights', '/sources', '/settings', '/activity', '/help', '/no-such-page'];

/** Detail pages need a real id: the prototype's sample ids are fixed, the demo's come from its API. */
async function detailRoutes(page: Page): Promise<string[]> {
  if (test.info().project.name === 'prototype') return ['/opportunities/101', '/applications/201'];
  const routes: string[] = [];
  const opps = (await (await page.request.get('/api/opportunities')).json()) as Array<{ id: number }>;
  if (opps[0]) routes.push(`/opportunities/${opps[0].id}`);
  const apps = (await (await page.request.get('/api/applications')).json()) as Array<{ id: number }>;
  if (apps[0]) routes.push(`/applications/${apps[0].id}`);
  return routes;
}

/**
 * Known issues outside this lane's files, waived by rule, element and scheme
 * only, so anything new still fails. Each one is reported as an annotation.
 * Dark mode: white text on the light red danger button (--bad #f08a7e) is
 * about 2.4:1; the fix belongs in src/web/styles.css (dark --bad or a dark text colour).
 */
const KNOWN: Array<{ rule: string; target: string; scheme: 'light' | 'dark' }> = [];

/** Runs axe on the page as it is now and fails on serious or critical issues. */
async function expectNoSeriousIssues(page: Page, label: string, scheme: 'light' | 'dark'): Promise<void> {
  const { violations } = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(TAGS).analyze();
  const bad: string[] = [];
  for (const v of violations) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue;
    const nodes = v.nodes.filter((n) => {
      const target = n.target.join(' ');
      const waived = KNOWN.some((k) => k.rule === v.id && k.scheme === scheme && target.includes(k.target));
      if (waived) test.info().annotations.push({ type: 'known a11y issue', description: `${label}: ${v.id} ${target}` });
      return !waived;
    });
    if (nodes.length) bad.push(`${v.impact} ${v.id}: ${v.help} (${nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  }
  expect(bad, `${label} has serious accessibility issues`).toEqual([]);
}

async function openRoute(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page.getByRole('main'), route).toBeAttached();
  // Lazy pages show a skeleton first; wait for the real heading text.
  await expect(page.locator('h1'), route).not.toHaveText('');
  await page.waitForLoadState('networkidle');
}

for (const width of [1280, 390]) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${width}px, ${scheme}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      });

      test('axe: every route has no serious or critical issues', async ({ page }) => {
        test.setTimeout(150_000);
        await page.goto('/');
        const routes = [...STATIC_ROUTES, ...(await detailRoutes(page))];
        for (const route of routes) {
          await openRoute(page, route);
          await expectNoSeriousIssues(page, route, scheme);
        }
      });

      test('axe: an open dialog has no serious or critical issues', async ({ page }) => {
        await openRoute(page, '/settings');
        await page.getByRole('button', { name: 'Reset to defaults' }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectNoSeriousIssues(page, 'the reset dialog', scheme);
      });

      if (width === 390) {
        test('axe: the open phone menu has no serious or critical issues', async ({ page }) => {
          await openRoute(page, '/');
          const menu = page.getByRole('button', { name: 'Menu' });
          await menu.click();
          await expect(menu).toHaveAttribute('aria-expanded', 'true');
          await expectNoSeriousIssues(page, 'the phone menu', scheme);
        });
      }
    });
  }
}

test('keyboard: Tab shows a visible focus ring', async ({ page }) => {
  await openApp(page, '/');
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return { visible: el.matches(':focus-visible'), outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow !== 'none' };
  });
  expect(ring, 'Tab moved focus off the page body').not.toBeNull();
  expect(ring!.visible).toBe(true);
  expect(ring!.outline || ring!.shadow, 'the focused element draws an outline or ring').toBe(true);
});

test('keyboard: Escape closes a dialog and returns focus to its button', async ({ page }) => {
  await openApp(page, '/settings');
  const opener = page.getByRole('button', { name: 'Reset to defaults' }).first();
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('keyboard: Escape closes the phone menu and returns focus to its button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openRoute(page, '/');
  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
});
