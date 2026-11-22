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

/** ALLOWED_HOSTS: a comma list of host names (a port, if given, is ignored). */
export function allowedHosts(env: NodeJS.ProcessEnv): string[] {
  return value(env, 'ALLOWED_HOSTS')
    .split(',')
    .map((h) => hostnameOf(h.trim()))
    .filter((h) => h !== '');
}

/** The host name of a Host header value or bare name, lower-cased, without port or IPv6 brackets. */
export function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') === -1 ? undefined : h.indexOf(']'));
  // A bare IPv6 address has several colons; anything else may end in ":port".
  return (h.split(':').length > 2 ? h : h.replace(/:\d*$/, '')).replace(/\.$/, '');
}

/**
 * TRUST_PROXY: "1" (or "true") trusts a reverse proxy on this computer only,
 * so a client cannot pick its own address with X-Forwarded-For. A comma list
 * of proxy addresses or ranges, or a hop count ("hops=2", or a number from 2
 * up), is also accepted. Anything else, or nothing, trusts no proxy.
 */
export function trustProxy(env: NodeJS.ProcessEnv): boolean | number | string {
  const raw = value(env, 'TRUST_PROXY');
  if (raw === '' || raw === '0' || /^(false|no|off)$/i.test(raw)) return false;
  if (raw === '1' || /^(true|yes|on)$/i.test(raw)) return '127.0.0.1,::1';
  const hops = /^(?:hops=)?(\d+)$/i.exec(raw);
  if (hops) return Number(hops[1]);
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(',');
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
    allowedHosts: allowedHosts(env),
    trustProxy: trustProxy(env),
  };
}
