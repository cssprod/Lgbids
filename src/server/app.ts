import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { hostnameOf } from './config.js';
import type { AppConfig, AppDeps, Pipeline, Scheduler } from './contracts.js';
import { registerApplications } from './routes/applications.js';
import { registerAuth } from './routes/auth.js';
import { registerAwards } from './routes/awards.js';
import { registerCoverage } from './routes/coverage.js';
import { registerDocuments } from './routes/documents.js';
import { registerFeedback } from './routes/feedback.js';
import { registerInsights } from './routes/insights.js';
import { registerManual } from './routes/manual.js';
import { registerOpportunities } from './routes/opportunities.js';
import { registerRecipients } from './routes/recipients.js';
import { registerRuns } from './routes/runs.js';
import { registerSearches } from './routes/searches.js';
import { registerSettings } from './routes/settings.js';
import { registerSources } from './routes/sources.js';
import { registerStatus } from './routes/status.js';
import { registerWatch } from './routes/watch.js';
import { ApiError, isZodError, MAX_UPLOAD_BYTES, zodSentence, type RouteContext } from './routes/util.js';

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  // The built web UI is plain files from this server: scripts, styles and API calls are all same-origin.
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

/** Fastify and plugin errors that are the caller's doing, with what to tell them. */
const CLIENT_ERRORS: Record<string, { status: number; message: string }> = {
  FST_ERR_CTP_INVALID_JSON_BODY: { status: 400, message: 'The request body is not valid JSON.' },
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, message: 'The request is too large.' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, message: 'This kind of request body is not supported. Send JSON or a form upload.' },
  FST_REQ_FILE_TOO_LARGE: { status: 413, message: `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB, which is the most that can be uploaded.` },
  FST_FILES_LIMIT: { status: 400, message: 'Please upload one file at a time.' },
  FST_PARTS_LIMIT: { status: 400, message: 'The upload form has too many fields.' },
  FST_FIELDS_LIMIT: { status: 400, message: 'The upload form has too many fields.' },
  FST_PROTO_VIOLATION: { status: 400, message: 'The upload form contains a field name that is not allowed.' },
  FST_INVALID_MULTIPART_CONTENT_TYPE: { status: 400, message: 'Please send the file as a form upload (multipart/form-data).' },
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isApiPath(url: string): boolean {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

/**
 * A browser always sends Origin on cross-site requests that change things;
 * when it names another site than the one the request is addressed to,
 * the request was made by some other web page and is refused.
 */
function crossOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin || SAFE_METHODS.has(req.method)) return false;
  const host = req.headers.host;
  if (!host) return true;
  try {
    const from = new URL(origin);
    // Compare host and port, with default ports filled in: browsers drop ":80"
    // from Origin, while some clients keep it in Host.
    const port = (url: URL) => url.port || (url.protocol === 'https:' ? '443' : '80');
    const to = new URL(`${from.protocol}//${host}`);
    return from.hostname.toLowerCase() !== to.hostname.toLowerCase() || port(from) !== port(to);
  } catch {
    return true;
  }
}

function isLoopbackName(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * Which Host header names the server answers to, or null for "any". A web
 * page on another site can point its own name at 127.0.0.1 (DNS rebinding)
 * and then talk to this server as if it were same-origin; checking the Host
 * header stops that. A server bound to a public address without
 * ALLOWED_HOSTS answers any name (a warning is logged at start).
 */
export function hostPolicy(config: Pick<AppConfig, 'host' | 'allowedHosts'>): ((hostname: string) => boolean) | null {
  const listed = new Set((config.allowedHosts ?? []).map(hostnameOf).filter(Boolean));
  const bind = hostnameOf(config.host);
  const loopbackBind = isLoopbackName(bind);
  if (!loopbackBind && listed.size === 0) return null;
  // A specific bind address (not 0.0.0.0 / ::) is also a name the server can be reached by.
  if (!loopbackBind && bind !== '0.0.0.0' && bind !== '::') listed.add(bind);
  return (hostname) => isLoopbackName(hostname) || listed.has(hostname);
}

/** Fastify's `trustProxy` as its types accept it; a hop count trusts the nearest `n` proxies. */
function proxyTrust(value: AppConfig['trustProxy']): boolean | string | ((address: string, hop: number) => boolean) {
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'number') return (_address, hop) => hop < value;
  return value ?? false;
}

export async function buildApp(deps: AppDeps, pipeline: Pipeline, scheduler: Scheduler): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' || process.env.VITEST ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    // Behind a reverse proxy (TRUST_PROXY=1) the client address and https come from X-Forwarded-* headers.
    trustProxy: proxyTrust(deps.config.trustProxy),
    bodyLimit: 2 * 1024 * 1024,
  });

  // Accept an empty JSON body (a bare POST from the UI) as "no fields" rather than an error.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new ApiError(400, 'The request body is not valid JSON.');
      done(err, undefined);
    }
  });

  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  const hostAllowed = hostPolicy(deps.config);
  if (!hostAllowed) {
    app.log.warn(
      `The server listens on ${deps.config.host} and answers to any host name. Set ALLOWED_HOSTS to the name(s) you use to reach it (for example ALLOWED_HOSTS=bids.example.com).`,
    );
  }

  app.addHook('onRequest', async (req, reply) => {
    reply.headers(SECURITY_HEADERS);
    if (hostAllowed && !hostAllowed(hostnameOf(req.headers.host ?? ''))) {
      reply.code(403).send({ error: 'This server does not answer to that address. Open it at http://localhost or add the name to ALLOWED_HOSTS.' });
      return reply;
    }
    if (crossOrigin(req)) {
      reply.code(403).send({ error: 'This request came from another website and was refused.' });
      return reply;
    }
  });

  app.setErrorHandler((err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.message });
    if (isZodError(err)) return reply.code(400).send({ error: zodSentence(err) });
    const code = (err as FastifyError).code;
    const known = code ? CLIENT_ERRORS[code] : undefined;
    if (known) return reply.code(known.status).send({ error: known.message });
    const status = (err as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'The request could not be processed. Please check what was entered and try again.' });
    }
    req.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'Something went wrong on the server. The details have been written to the server log.' });
  });

  const ctx: RouteContext = { deps, pipeline, scheduler };
  registerAuth(app, ctx);
  registerRuns(app, ctx);
  registerOpportunities(app, ctx);
  registerApplications(app, ctx);
  registerSettings(app, ctx);
  registerSources(app, ctx);
  registerDocuments(app, ctx);
  // v2 routes (stubs answer 501 until their work package lands).
  registerManual(app, ctx);
  registerWatch(app, ctx);
  registerFeedback(app, ctx);
  registerAwards(app, ctx);
  registerSearches(app, ctx);
  registerCoverage(app, ctx);
  registerRecipients(app, ctx);
  registerStatus(app, ctx);
  registerInsights(app, ctx);

  const webDir = deps.config.webDir ? resolve(deps.config.webDir) : '';
  const hasIndex = webDir !== '' && existsSync(resolve(webDir, 'index.html'));
  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: '/',
      index: 'index.html',
      // Sends the .br / .gz copies written by scripts/compress.mjs to browsers that accept them.
      preCompressed: true,
      cacheControl: false,
      setHeaders(res, path) {
        // Built files have a content hash in their name, so they never change: cache them for a year.
        // Everything else (index.html, the manifest, icons) is checked again on each visit.
        res.header('cache-control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/plain; charset=utf-8')
        .send('Lgbids is running, but the web UI has not been built yet. Run `npm run build` and restart the server, or use `npm run dev` while developing.\n'),
    );
  }

  app.setNotFoundHandler((req, reply) => {
    // Client-side routes (/opportunities/12 ...) all load the single page app.
    if (hasIndex && (req.method === 'GET' || req.method === 'HEAD') && !isApiPath(req.url)) {
      reply.header('cache-control', 'no-cache').sendFile('index.html');
      return;
    }
    reply.code(404).send({ error: 'There is nothing at this address.' });
  });

  return app;
}
