import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests (specs live in e2e/, outside the vitest tests/ folder).
 *
 *   demo       `npm run demo` on $E2E_DEMO_PORT (default 4317), data in .e2e/data-demo
 *   prototype  dist/prototype on $E2E_PROTO_PORT (default 4318) with its Netlify
 *              headers and redirects; or the hosted copy when PROTOTYPE_URL is set
 *
 * Ports come from the environment so parallel worktrees never clash. Build first:
 * `npm run build && npm run build:prototype` (the demo serves dist/web).
 */

// The sandbox has Chromium pre-installed here, so no `playwright install` is needed.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const demoPort = Number(process.env.E2E_DEMO_PORT || 4317);
const protoPort = Number(process.env.E2E_PROTO_PORT || 4318);
const demoUrl = `http://127.0.0.1:${demoPort}`;
const protoUrl = process.env.PROTOTYPE_URL || `http://127.0.0.1:${protoPort}`;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  outputDir: '.e2e/results',
  // The demo is one server with one database: tests share it, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 30_000,
  reporter: ci ? [['list'], ['html', { open: 'never', outputFolder: '.e2e/report' }]] : 'list',
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'demo', use: { baseURL: demoUrl } },
    { name: 'prototype', use: { baseURL: protoUrl } },
  ],
  webServer: [
    {
      command: 'npm run demo',
      url: `${demoUrl}/api/health`,
      env: { PORT: String(demoPort), HOST: '127.0.0.1', DEMO_DATA_DIR: '.e2e/data-demo', DEMO_MAIL_LOG: '.e2e/mail-demo.jsonl', APP_PASSWORD: '' },
      reuseExistingServer: !ci,
      timeout: 120_000,
      stdout: 'ignore',
    },
    ...(process.env.PROTOTYPE_URL
      ? []
      : [
          {
            command: 'node e2e/support/serve-prototype.mjs',
            url: `${protoUrl}/`,
            env: { E2E_PROTO_PORT: String(protoPort) },
            reuseExistingServer: !ci,
            timeout: 30_000,
          },
        ]),
  ],
});
