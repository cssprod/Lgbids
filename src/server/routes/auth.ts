import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SessionInfo } from '../../shared/api.js';
import { ApiError, parseBody, type RouteContext } from './util.js';

export const SESSION_COOKIE = 'lgbids_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 10 * 60 * 1000;
/**
 * Wrong passwords from all addresses together. Someone who can change their
 * address on every try (or a proxy setting that lets them claim any address)
 * still gets only this many guesses per window.
 */
const MAX_GLOBAL_FAILURES = 30;
/** The per-address table never grows past this; the oldest entries go first. */
const MAX_TRACKED_ADDRESSES = 1000;
const MIN_PASSWORD_LENGTH = 12;

/** Routes anyone may call, so the UI can find out whether to show the sign-in page. */
const PUBLIC_ROUTES = new Set(['GET /api/session', 'POST /api/login', 'GET /api/health']);

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Comparing fixed-length digests keeps the time taken independent of where the passwords differ. */
export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
}

/** A short password is fine on this computer only; anywhere else it can be guessed. */
export function weakPasswordWarning(config: { host: string; appPassword: string }): string | null {
  if (config.appPassword === '' || config.appPassword.length >= MIN_PASSWORD_LENGTH || isLoopbackHost(config.host)) return null;
  return `APP_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters while the server listens on ${config.host}. Please choose a longer password.`;
}

function minutesUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 60000));
}

function pathOf(req: FastifyRequest): string {
  const url = req.url;
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

export function registerAuth(app: FastifyInstance, ctx: RouteContext): void {
  const { config, store, now } = ctx.deps;
  const authRequired = config.appPassword !== '';
  // Failed sign-ins per client address: the count and when the window started.
  const failures = new Map<string, { count: number; since: number }>();
  // Times of recent failed sign-ins from any address, oldest first (at most MAX_GLOBAL_FAILURES).
  const recentFailures: number[] = [];

  const weak = weakPasswordWarning(config);
  if (weak) app.log.warn(weak);

  function recordFailure(ip: string, at: number): void {
    const current = failures.get(ip);
    failures.delete(ip);
    failures.set(ip, { count: (current?.count ?? 0) + 1, since: current?.since ?? at });
    if (failures.size > MAX_TRACKED_ADDRESSES) {
      for (const [key, value] of failures) if (at - value.since > LOCKOUT_MS) failures.delete(key);
      // Still too many: forget the oldest windows first (a Map keeps insertion order).
      for (const key of failures.keys()) {
        if (failures.size <= MAX_TRACKED_ADDRESSES) break;
        failures.delete(key);
      }
    }
    recentFailures.push(at);
    if (recentFailures.length > MAX_GLOBAL_FAILURES) recentFailures.shift();
  }

  function signedIn(req: FastifyRequest): boolean {
    if (!authRequired) return true;
    const token = req.cookies[SESSION_COOKIE];
    return !!token && /^[0-9a-f]{64}$/.test(token) && store.sessionValid(token, now());
  }

  function info(authenticated: boolean): SessionInfo {
    return { authRequired, authenticated, demo: config.demo };
  }

  function cookieOptions(req: FastifyRequest) {
    // A secure-only cookie would never come back over plain http on localhost.
    return { httpOnly: true, sameSite: 'strict' as const, path: '/', secure: req.protocol === 'https' };
  }

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = pathOf(req);
    if (!authRequired || !(path === '/api' || path.startsWith('/api/'))) return;
    if (PUBLIC_ROUTES.has(`${req.method} ${path}`)) return;
    if (!signedIn(req)) {
      reply.code(401).send({ error: 'Please sign in to continue.' });
      return reply;
    }
  });

  // For hosting platforms and uptime monitors; reveals nothing.
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/session', async (req) => info(signedIn(req)));

  app.post('/api/login', async (req, reply) => {
    if (!authRequired) return info(true);
    const ip = req.ip;
    const at = Date.now();
    while (recentFailures.length > 0 && at - recentFailures[0]! > LOCKOUT_MS) recentFailures.shift();
    if (recentFailures.length >= MAX_GLOBAL_FAILURES) {
      const minutes = minutesUntil(recentFailures[0]! + LOCKOUT_MS, at);
      throw new ApiError(429, `Too many wrong passwords have been tried, so sign-in is paused. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`);
    }
    const record = failures.get(ip);
    if (record && at - record.since > LOCKOUT_MS) failures.delete(ip);
    const current = failures.get(ip);
    if (current && current.count >= MAX_FAILURES) {
      const minutes = minutesUntil(current.since + LOCKOUT_MS, at);
      throw new ApiError(429, `Too many wrong passwords. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`);
    }

    const { password } = parseBody(z.object({ password: z.string().max(1000) }), req.body);
    if (!passwordMatches(password, config.appPassword)) {
      recordFailure(ip, at);
      throw new ApiError(401, 'That password is not correct.');
    }
    failures.delete(ip);

    const token = randomBytes(32).toString('hex');
    const nowDate = now();
    const expires = new Date(nowDate.getTime() + SESSION_DAYS * 86_400_000);
    store.createSession(token, expires, nowDate);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions(req), expires });
    return info(true);
  });

  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) store.deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, cookieOptions(req));
    return info(!authRequired);
  });
}
