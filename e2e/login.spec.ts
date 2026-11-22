import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';

// Sign-in with APP_PASSWORD. The shared demo server runs without a password,
// so this spec starts its own demo copy on a separate port and data folder.

test.skip(() => test.info().project.name !== 'demo', 'Needs a demo server it can start with a password.');
test.describe.configure({ mode: 'serial' });

const port = Number(process.env.E2E_LOGIN_PORT || 4319);
const base = `http://127.0.0.1:${port}`;
const password = 'e2e-login-check';
let server: ChildProcess | undefined;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = spawn('npm', ['run', 'demo'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DEMO_DATA_DIR: '.e2e/data-login', APP_PASSWORD: password, DEMO_MAIL_LOG: '' },
    stdio: 'ignore',
    detached: true,
  });
  await expect
    .poll(async () => fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false), { timeout: 110_000, intervals: [500, 1000] })
    .toBe(true);
});

test.afterAll(() => {
  // npm starts the demo as a child, so stop the whole process group.
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGINT');
    } catch {
      /* already gone */
    }
  }
});

test('a wrong password shows a sentence, the right one signs in', async ({ page }) => {
  await page.goto(`${base}/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  // A full sentence, not a code.
  await expect(page.getByRole('alert')).toHaveText(/That password is not \w+\.$/);

  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
});
