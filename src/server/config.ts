import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IANAZone } from 'luxon';
import type { AppConfig } from './contracts.js';

/** Startup configuration from environment variables, with defaults that suit one person on one machine. */

const DEFAULT_ZONE = 'America/Vancouver';

function value(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? '';
}

function port(env: NodeJS.ProcessEnv): number {
  const raw = value(env, 'PORT');
  if (!raw) return 3000;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > 65535) throw new Error(`PORT must be a number from 1 to 65535, not "${raw}".`);
  return n;
}

function webDir(env: NodeJS.ProcessEnv): string {
  const raw = value(env, 'WEB_DIR');
  if (raw) return existsSync(resolve(raw)) ? resolve(raw) : '';
  // The built UI sits next to the compiled server (dist/server → dist/web). When the
  // server runs from source (tsx), ../web is the unbuilt src/web, so use dist/web.
  const candidates = [new URL('../web', import.meta.url), new URL('../../dist/web', import.meta.url)].map((u) => fileURLToPath(u));
  return candidates.find((dir) => existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'assets'))) ?? '';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const zone = value(env, 'TZ_LOCAL');
  return {
    port: port(env),
    host: value(env, 'HOST') || '127.0.0.1',
    dataDir: resolve(value(env, 'DATA_DIR') || './data'),
    // Taken as given: spaces may be part of a password.
    appPassword: env.APP_PASSWORD ?? '',
    // An unknown zone would make every local time wrong, so fall back to the default.
    timeZone: zone && IANAZone.isValidZone(zone) ? zone : DEFAULT_ZONE,
    demo: value(env, 'LGBIDS_DEMO') === '1',
    webDir: webDir(env),
  };
}
