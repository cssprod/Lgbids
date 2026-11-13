import { setTimeout as sleep } from 'node:timers/promises';
import { RobotsCache } from './robots.js';

/**
 * The only way the app talks to bid sites. It identifies itself, obeys
 * robots.txt, never sends two requests to the same host closer together than
 * the configured delay, retries politely, and caps response sizes.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status: number | null,
    /** The site (or its robots.txt) refused automated access. */
    readonly blocked: boolean,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface HttpClientOptions {
  userAgent: string;
  respectRobots: boolean;
  /** Minimum gap between two requests to the same host, in milliseconds. */
  delayMs: number;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  accept?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  /** Treat this status as a normal outcome instead of throwing (e.g. 304). */
  allowStatus?: number[];
}

export interface HttpResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  headers: Headers;
  contentType: string;
  body: Buffer;
  text: string;
}

export interface RequestLogEntry {
  url: string;
  status: number | null;
  bytes: number;
  ms: number;
  error?: string;
}

const RETRY_STATUS = new Set([429, 502, 503, 504]);
const CHALLENGE_MARKERS = [
  /<title>\s*(?:just a moment|attention required|access denied|request rejected|pardon our interruption|are you a robot|security check)/i,
  /cf-browser-verification|cf_chl_|challenge-platform|_Incapsula_Resource|hcaptcha\.com\/1\/api|g-recaptcha|px-captcha|distil_r_captcha/i,
];

/**
 * True when an HTML page is a bot check rather than real content: it carries a
 * known challenge marker and is a small page with no content structure. (A
 * normal page that merely embeds a captcha widget in a form is not a challenge.)
 */
export function looksLikeChallenge(html: string): boolean {
  if (html.length > 60_000) return false;
  if (/<table|<article|<main|<li[ >]/i.test(html)) return false;
  return CHALLENGE_MARKERS.some((re) => re.test(html));
}

export class HttpClient {
  readonly log: RequestLogEntry[] = [];
  private readonly lastRequest = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly robots: RobotsCache;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.robots = new RobotsCache(options.userAgent, (url) => this.raw(url, { accept: 'text/plain', maxBytes: 500_000, timeoutMs: 15_000 }, 0));
  }

  /** Wait for this host's turn so requests to one site are spaced out. */
  private async turn(host: string): Promise<void> {
    const previous = this.queues.get(host) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    this.queues.set(host, previous.then(() => mine));
    await previous;
    const last = this.lastRequest.get(host) ?? 0;
    const wait = last + this.options.delayMs - Date.now();
    try {
      if (wait > 0) await sleep(wait);
    } finally {
      this.lastRequest.set(host, Date.now());
      release();
    }
  }

  private async raw(url: string, opts: RequestOptions, retries: number): Promise<HttpResult> {
    const target = new URL(url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new HttpError(`Unsupported address: ${url}`, url, null, false);
    }
    const maxBytes = opts.maxBytes ?? this.options.maxBytes ?? 6_000_000;
    const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    let attempt = 0;
    for (;;) {
      await this.turn(target.host);
      const started = Date.now();
      try {
        const response = await this.fetchImpl(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'user-agent': this.options.userAgent,
            accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-CA,en;q=0.9',
            ...opts.headers,
          },
        });

        if (RETRY_STATUS.has(response.status) && attempt < retries) {
          await response.body?.cancel().catch(() => undefined);
          const retryAfter = Number(response.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2000 * (attempt + 1) ** 2;
          this.log.push({ url, status: response.status, bytes: 0, ms: Date.now() - started, error: 'retrying' });
          attempt += 1;
          await sleep(wait);
          continue;
        }

        const body = await readCapped(response, maxBytes, url);
        const contentType = response.headers.get('content-type') ?? '';
        this.log.push({ url, status: response.status, bytes: body.length, ms: Date.now() - started });

        const allowed = opts.allowStatus?.includes(response.status);
        if (!response.ok && !allowed) {
          const blocked = response.status === 401 || response.status === 403 || response.status === 429;
          throw new HttpError(
            blocked ? `The site refused the request (HTTP ${response.status}).` : `The site answered with an error (HTTP ${response.status}).`,
            url,
            response.status,
            blocked,
          );
        }
        const text = isTextual(contentType) ? decode(body, contentType) : '';
        if (response.ok && /html/i.test(contentType) && looksLikeChallenge(text)) {
          throw new HttpError('The site showed a bot check instead of the page.', url, response.status, true);
        }
        return { url: response.url || url, status: response.status, headers: response.headers, contentType, body, text };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        const message = describeNetworkError(error);
        this.log.push({ url, status: null, bytes: 0, ms: Date.now() - started, error: message });
        if (attempt < retries) {
          attempt += 1;
          await sleep(1500 * attempt);
          continue;
        }
        throw new HttpError(message, url, null, false);
      }
    }
  }

  /** GET a page, feed or API response. Throws HttpError on any failure. */
  async get(url: string, opts: RequestOptions = {}): Promise<HttpResult> {
    if (this.options.respectRobots) {
      const allowed = await this.robots.allowed(url);
      if (!allowed) {
        this.log.push({ url, status: null, bytes: 0, ms: 0, error: 'robots.txt' });
        throw new HttpError("The site's robots.txt asks automated tools not to read this page.", url, null, true);
      }
    }
    return this.raw(url, opts, this.options.retries ?? 2);
  }

  /**
   * GET a large file as a stream (the CanadaBuys CSV is tens of megabytes).
   * The caller must consume or cancel the body.
   */
  async stream(url: string, opts: RequestOptions = {}): Promise<{ response: Response; url: string }> {
    const target = new URL(url);
    if (this.options.respectRobots && !(await this.robots.allowed(url))) {
      throw new HttpError("The site's robots.txt asks automated tools not to read this file.", url, null, true);
    }
    await this.turn(target.host);
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
        headers: { 'user-agent': this.options.userAgent, accept: opts.accept ?? '*/*', ...opts.headers },
      });
    } catch (error) {
      const message = describeNetworkError(error);
      this.log.push({ url, status: null, bytes: 0, ms: Date.now() - started, error: message });
      throw new HttpError(message, url, null, false);
    }
    this.log.push({ url, status: response.status, bytes: Number(response.headers.get('content-length') ?? 0), ms: Date.now() - started });
    if (!response.ok && !opts.allowStatus?.includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      const blocked = response.status === 401 || response.status === 403 || response.status === 429;
      throw new HttpError(
        blocked ? `The site refused the request (HTTP ${response.status}).` : `The site answered with an error (HTTP ${response.status}).`,
        url,
        response.status,
        blocked,
      );
    }
    return { response, url: response.url || url };
  }
}

async function readCapped(response: Response, maxBytes: number, url: string): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(`The response was larger than ${Math.round(maxBytes / 1_000_000)} MB and was not read.`, url, response.status, false);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function isTextual(contentType: string): boolean {
  return !contentType || /text\/|json|xml|javascript|csv|html/i.test(contentType);
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  try {
    return new TextDecoder(charset && charset !== 'utf8' ? charset : 'utf-8').decode(body);
  } catch {
    return body.toString('utf8');
  }
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'The site did not answer in time.';
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    const code = cause?.code ?? '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The site address could not be found (DNS).';
    if (code === 'ECONNREFUSED') return 'The site refused the connection.';
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'The connection was dropped.';
    if (code.startsWith('CERT_') || code.includes('CERT') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') return 'The site has a certificate problem.';
    return `Could not reach the site (${code || cause?.message || error.message}).`;
  }
  return 'Could not reach the site.';
}
