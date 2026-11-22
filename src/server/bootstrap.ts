import { mkdirSync, mkdtempSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { buildApp } from './app.js';
import type { AppConfig, AppDeps, Pipeline, Scheduler } from './contracts.js';
import { openDatabase } from './db/database.js';
import { createStore } from './db/store.js';
import { createFileStore } from './files.js';
import { HttpClient, USER_AGENT, type HttpClientOptions } from './http/client.js';
import { createPipeline } from './pipeline/run.js';
import { createScheduler } from './pipeline/scheduler.js';
import { createSettings } from './settings.js';
import { createImapMailbox } from './sources/alerts/mailbox.js';
import { DEFAULT_SOURCES } from './sources/registry.js';
import { createMailer } from './submission/email.js';

/**
 * Wire the server's parts together. Tests and the CLI tools pass overrides
 * (an in-memory store, a fake mailer, a fixed clock) for whatever they replace.
 */
export function createDeps(config: AppConfig, overrides: Partial<AppDeps> = {}): AppDeps {
  const inMemory = config.dataDir === ':memory:';
  if (!inMemory) mkdirSync(config.dataDir, { recursive: true });

  const now = overrides.now ?? (() => new Date());
  const store = overrides.store ?? createStore(openDatabase(inMemory ? ':memory:' : join(config.dataDir, 'lgbids.sqlite')));
  const settings = overrides.settings ?? createSettings(store, process.env, now);
  // An in-memory database has nowhere permanent for uploads either, so they go to a throw-away folder.
  const files = overrides.files ?? createFileStore(inMemory ? mkdtempSync(join(tmpdir(), 'lgbids-files-')) : config.dataDir);
  const mailerFactory = overrides.mailerFactory ?? createMailer;
  const httpFactory =
    overrides.httpFactory ?? ((a) => new HttpClient(httpOptionsFor(a, config)));

  const alertMailboxFactory = overrides.alertMailboxFactory ?? createImapMailbox;
  const alertImportDir = overrides.alertImportDir ?? (inMemory ? mkdtempSync(join(tmpdir(), 'lgbids-alerts-')) : join(config.dataDir, 'alert-inbox'));

  // Demo mode brings its own sample sources; the real ones would only fail against the sample data.
  if (!config.demo) store.seedSources(DEFAULT_SOURCES, now());
  store.failStaleRuns(now());

  return { config, store, settings, files, mailerFactory, httpFactory, alertMailboxFactory, alertImportDir, now, ...(overrides.pushFetch ? { pushFetch: overrides.pushFetch } : {}) };
}

/**
 * The stored "respect robots.txt" switch and user agent are ignored (decision
 * D2): robots.txt is always obeyed and the user agent is the fixed
 * `Lgbids/<version>`. Only the request delay comes from the settings.
 */
export function httpOptionsFor(a: { requestDelayMs: number }, config: Pick<AppConfig, 'demo'>): HttpClientOptions {
  return { userAgent: USER_AGENT, delayMs: a.requestDelayMs, allowPrivate: config.demo };
}

export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1') return true;
  return isIP(h) === 4 && h.startsWith('127.');
}

/**
 * British Columbia stopped changing its clocks in 2026 and stays on UTC−7.
 * A Node.js build with older time zone data still puts Vancouver on UTC−8 in
 * winter, which would show winter closing times an hour off.
 */
export function timeZoneWarning(now: Date = new Date()): string | null {
  const year = DateTime.fromJSDate(now).year + 1;
  const offset = DateTime.fromObject({ year, month: 1, day: 15, hour: 12 }, { zone: 'America/Vancouver' }).offset;
  if (offset !== -480) return null;
  return [
    `Warning: this Node.js build has outdated time zone data (tz ${process.versions.tz ?? 'unknown'}).`,
    'British Columbia has been on UTC−7 year-round since 2026, but this runtime still uses UTC−8 for America/Vancouver in winter.',
    'Closing times may be shown an hour off until Node.js is updated.',
  ].join('\n');
}

export function displayUrl(config: AppConfig, port: number): string {
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export interface StartedServer {
  url: string;
  deps: AppDeps;
  pipeline: Pipeline;
  scheduler: Scheduler;
  stop(): Promise<void>;
}

/** Start the whole app. Also used by demo mode, with its own config and data folder. */
export async function startServer(config: AppConfig, deps: AppDeps = createDeps(config)): Promise<StartedServer> {
  const pipeline = createPipeline(deps);
  const scheduler = createScheduler(deps, pipeline);
  const app = await buildApp(deps, pipeline, scheduler);
  await app.listen({ port: config.port, host: config.host });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  scheduler.start();
  let stopped = false;
  return {
    url: displayUrl(config, port),
    deps,
    pipeline,
    scheduler,
    async stop() {
      if (stopped) return;
      stopped = true;
      scheduler.stop();
      await app.close();
      deps.store.close();
    },
  };
}
