import { readFileSync } from 'node:fs';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { RobotsCache } from './robots.js';

/**
 * The only way the app talks to bid sites. It identifies itself, obeys
 * robots.txt on every redirect hop, refuses addresses inside this computer or
 * the local network, never sends two requests to the same host closer
 * together than the configured delay, retries politely, and caps response sizes.
 */

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0';
  } catch {
    return '0';
  }
}

/** The fixed user agent: site owners can always see who is reading and match it in robots.txt. */
export const USER_AGENT = `Lgbids/${appVersion()}`;

/** At most this many redirects are followed for one request. */
export const MAX_REDIRECTS = 5;

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

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
  /** Ignored unless it starts with "Lgbids"; the fixed `USER_AGENT` is used otherwise. */
  userAgent?: string;
  /**
   * Ignored: robots.txt is always respected (decision D2). Kept so older
   * callers still compile.
   */
  respectRobots?: boolean;
  /** Minimum gap between two requests to the same host, in milliseconds. */
  delayMs: number;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  /**
   * Allow requests to this computer and private network addresses. Only the
   * demo sites and local test servers need it; bid sites are always public.
   */
  allowPrivate?: boolean;
  /** DNS lookup used by the address check; tests inject one. */
  lookup?: LookupFn;
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
  /** Set when this hop answered with a redirect. */
  redirectTo?: string;
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

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function statusError(status: number, url: string): HttpError {
  const blocked = status === 401 || status === 403 || status === 429;
  return new HttpError(
    blocked ? `The site refused the request (HTTP ${status}).` : `The site answered with an error (HTTP ${status}).`,
    url,
    status,
    blocked,
  );
}

interface Hop {
  response: Response;
  url: string;
  started: number;
}

export class HttpClient {
  readonly log: RequestLogEntry[] = [];
  private readonly lastRequest = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly robots: RobotsCache;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly respectRobots: boolean;
  private readonly allowPrivate: boolean;
  private readonly lookup: LookupFn;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent && /^Lgbids/i.test(options.userAgent) ? options.userAgent : USER_AGENT;
    // robots.txt is always respected (D2); `respectRobots: false` is ignored.
    this.respectRobots = true;
    this.allowPrivate = options.allowPrivate ?? false;
    this.lookup = options.lookup ?? defaultLookup;
    this.robots = new RobotsCache(this.userAgent, async (url) => {
      try {
        const result = await this.fetchFollowing(url, { accept: 'text/plain', timeoutMs: 15_000 }, 0, false);
        const text = decode(await readCapped(result.response, 500_000, result.url), result.response.headers.get('content-type') ?? '');
        if (result.response.status >= 400 && result.response.status < 500) return { status: result.response.status, text: '' };
        if (!result.response.ok) throw statusError(result.response.status, result.url);
        return { status: result.response.status, text };
      } catch (error) {
        // A 4xx robots.txt is "no rules"; everything else makes it unreadable.
        if (error instanceof HttpError && error.status !== null && error.status >= 400 && error.status < 500) return { status: error.status, text: '' };
        throw error;
      }
    });
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

  /**
   * Refuse addresses inside this computer or the local network (loopback,
   * private ranges, link-local such as cloud metadata at 169.254.169.254,
   * CGNAT, unique-local, multicast, 0.0.0.0), so a source address or a
   * redirect cannot make the server read internal services.
   */
  private async guardAddress(target: URL): Promise<void> {
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new HttpError(`Unsupported address: ${target.href}`, target.href, null, false);
    }
    if (this.allowPrivate) return;
    const host = target.hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    if (isIP(host)) {
      addresses = [host];
    } else {
      try {
        addresses = (await this.lookup(host)).map((a) => a.address);
      } catch {
        throw new HttpError('The site address could not be found (DNS).', target.href, null, false);
      }
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      this.log.push({ url: target.href, status: null, bytes: 0, ms: 0, error: 'private address' });
      throw new HttpError('This address points inside this computer or a private network, so Lgbids will not read it.', target.href, null, true);
    }
  }

  private async guardRobots(url: string, what: 'page' | 'file'): Promise<void> {
    if (!this.respectRobots) return;
    const verdict = await this.robots.check(url);
    if (verdict.allowed) return;
    this.log.push({ url, status: null, bytes: 0, ms: 0, error: verdict.unreadable ? 'robots.txt unreadable' : 'robots.txt' });
    throw new HttpError(
      verdict.unreadable
        ? `The site's robots.txt could not be read, so Lgbids did not read this ${what}.`
        : `The site's robots.txt asks automated tools not to read this ${what}.`,
      url,
      null,
      // An unreadable robots.txt usually means the site is down, not that it
      // refuses tools, so it reports as an error that the next run retries.
      !verdict.unreadable,
    );
  }

  /** One request to one URL, with polite retries. The body is not read. */
  private async once(url: string, opts: RequestOptions, retries: number): Promise<Hop> {
    const target = new URL(url);
    const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    let attempt = 0;
    for (;;) {
      await this.turn(target.host);
      const started = Date.now();
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'user-agent': this.userAgent,
            accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-CA,en;q=0.9',
            ...opts.headers,
          },
        });
      } catch (error) {
        const message = describeNetworkError(error);
        this.log.push({ url, status: null, bytes: 0, ms: Date.now() - started, error: message });
        if (attempt < retries) {
          attempt += 1;
          await sleep(1500 * attempt);
          continue;
        }
        throw new HttpError(message, url, null, false);
      }
      if (RETRY_STATUS.has(response.status) && attempt < retries) {
        await response.body?.cancel().catch(() => undefined);
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2000 * (attempt + 1) ** 2;
        this.log.push({ url, status: response.status, bytes: 0, ms: Date.now() - started, error: 'retrying' });
        attempt += 1;
        await sleep(wait);
        continue;
      }
      return { response, url, started };
    }
  }

  /**
   * Follow redirects by hand, so every new address gets the same checks as
   * the first one: the address guard, and robots.txt unless this is itself a
   * robots.txt fetch.
   */
  private async fetchFollowing(url: string, opts: RequestOptions, retries: number, checkRobots: boolean, what: 'page' | 'file' = 'page'): Promise<Hop> {
    const seen = new Set<string>();
    let current = url;
    for (let hop = 0; ; hop += 1) {
      const target = new URL(current);
      await this.guardAddress(target);
      if (checkRobots) await this.guardRobots(current, what);
      seen.add(current);
      const result = await this.once(current, opts, retries);
      const location = result.response.headers.get('location');
      if (!REDIRECT_STATUS.has(result.response.status) || !location || opts.allowStatus?.includes(result.response.status)) return result;
      await result.response.body?.cancel().catch(() => undefined);
      let next: string;
      try {
        next = new URL(location, current).href;
      } catch {
        throw new HttpError('The site redirected to an address that is not valid.', current, result.response.status, false);
      }
      this.log.push({ url: current, status: result.response.status, bytes: 0, ms: Date.now() - result.started, redirectTo: next });
      if (seen.has(next)) throw new HttpError('The site keeps redirecting in a loop.', current, result.response.status, false);
      if (hop + 1 > MAX_REDIRECTS) throw new HttpError(`The site redirected more than ${MAX_REDIRECTS} times.`, current, result.response.status, false);
      current = next;
    }
  }

  /** GET a page, feed or API response. Throws HttpError on any failure. */
  async get(url: string, opts: RequestOptions = {}): Promise<HttpResult> {
    const maxBytes = opts.maxBytes ?? this.options.maxBytes ?? 6_000_000;
    const { response, url: finalUrl, started } = await this.fetchFollowing(url, opts, this.options.retries ?? 2, true);
    let body: Buffer;
    try {
      body = await readCapped(response, maxBytes, finalUrl);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const message = describeNetworkError(error);
      this.log.push({ url: finalUrl, status: null, bytes: 0, ms: Date.now() - started, error: message });
      throw new HttpError(message, finalUrl, null, false);
    }
    const contentType = response.headers.get('content-type') ?? '';
    this.log.push({ url: finalUrl, status: response.status, bytes: body.length, ms: Date.now() - started });
    if (!response.ok && !opts.allowStatus?.includes(response.status)) throw statusError(response.status, finalUrl);
    const text = isTextual(contentType) ? decode(body, contentType) : '';
    if (response.ok && /html/i.test(contentType) && looksLikeChallenge(text)) {
      throw new HttpError('The site showed a bot check instead of the page.', finalUrl, response.status, true);
    }
    return { url: finalUrl, status: response.status, headers: response.headers, contentType, body, text };
  }

  /**
   * GET a large file as a stream (the CanadaBuys CSV is tens of megabytes).
   * The caller must consume or cancel the body.
   */
  async stream(url: string, opts: RequestOptions = {}): Promise<{ response: Response; url: string }> {
    const { response, url: finalUrl, started } = await this.fetchFollowing(url, { accept: '*/*', timeoutMs: 180_000, ...opts }, 0, true, 'file');
    this.log.push({ url: finalUrl, status: response.status, bytes: Number(response.headers.get('content-length') ?? 0), ms: Date.now() - started });
    if (!response.ok && !opts.allowStatus?.includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw statusError(response.status, finalUrl);
    }
    return { response, url: finalUrl };
  }
}

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** True for addresses that are not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (isIP(ip) === 4) {
    const [a, b] = ipv4Parts(ip)!;
    return (
      a === 0 || // 0.0.0.0/8, "this network"
      a === 10 ||
      a === 127 ||
      (a === 100 && b! >= 64 && b! <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && ipv4Parts(ip)![2] === 0) || // IETF protocol assignments
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a! >= 224 // multicast, reserved, broadcast
    );
  }
  if (isIP(ip) === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as IPv4.
    const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip) ?? /^::(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]!);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1]!, 16);
      const lo = parseInt(hexMapped[2]!, 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (ip === '::' || ip === '::1') return true;
    const first = parseInt(ip.split(':')[0] || '0', 16);
    return (
      (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
      (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
      (first & 0xff00) === 0xff00 // multicast ff00::/8
    );
  }
  return true;
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
