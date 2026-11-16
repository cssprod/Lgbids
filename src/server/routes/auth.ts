import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SessionInfo } from '../../shared/api.js';
import { ApiError, parseBody, type RouteContext } from './util.js';

export const SESSION_COOKIE = 'lgbids_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 10 * 60 * 1000;

/** Routes anyone may call, so the UI can find out whether to show the sign-in page. */
const PUBLIC_ROUTES = new Set(['GET /api/session', 'POST /api/login']);

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Comparing fixed-length digests keeps the time taken independent of where the passwords differ. */
export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
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

  app.get('/api/session', async (req) => info(signedIn(req)));

  app.post('/api/login', async (req, reply) => {
    if (!authRequired) return info(true);
    const ip = req.ip;
    const at = Date.now();
    const record = failures.get(ip);
    if (record && at - record.since > LOCKOUT_MS) failures.delete(ip);
    const current = failures.get(ip);
    if (current && current.count >= MAX_FAILURES) {
      const minutes = Math.max(1, Math.ceil((current.since + LOCKOUT_MS - at) / 60000));
      throw new ApiError(429, `Too many wrong passwords. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`);
    }

    const { password } = parseBody(z.object({ password: z.string().max(1000) }), req.body);
    if (!passwordMatches(password, config.appPassword)) {
      failures.set(ip, { count: (current?.count ?? 0) + 1, since: current?.since ?? at });
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
