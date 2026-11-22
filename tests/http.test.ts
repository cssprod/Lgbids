import { describe, expect, it } from 'vitest';
import { httpOptionsFor } from '../src/server/bootstrap.js';
import { HttpClient, HttpError, isPrivateAddress, USER_AGENT, type LookupFn } from '../src/server/http/client.js';
import { listSource } from '../src/server/sources/registry.js';
import { sourceConfigSchema, type SourceRecord } from '../src/shared/schemas.js';
import { defaultRegion } from '../src/server/matching/geo.js';

type Route = { status: number; body?: string; headers?: Record<string, string> } | 'network-error';

/** A pretend internet: every URL maps to a canned answer, and every request is recorded. */
function fakeWeb(routes: Record<string, Route>) {
  const requested: string[] = [];
  const agents: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    agents.push(new Headers(init?.headers).get('user-agent') ?? '');
    expect(init?.redirect).toBe('manual');
    const route = routes[url];
    if (route === 'network-error') throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    if (!route) return new Response('not found', { status: 404 });
    return new Response(route.body ?? '', { status: route.status, headers: { 'content-type': 'text/html', ...route.headers } });
  }) as typeof fetch;
  return { fetchImpl, requested, agents };
}

const publicLookup: LookupFn = async () => [{ address: '203.0.113.10', family: 4 }];

function client(routes: Record<string, Route>, extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  const web = fakeWeb(routes);
  const http = new HttpClient({ delayMs: 0, retries: 0, allowPrivate: false, lookup: publicLookup, fetchImpl: web.fetchImpl, ...extra });
  return { http, ...web };
}

const PAGE = { status: 200, body: '<html><body><main>Bids</main></body></html>' };
const OPEN_ROBOTS = { status: 200, body: 'User-agent: *\nDisallow:\n', headers: { 'content-type': 'text/plain' } };
const CLOSED_ROBOTS = { status: 200, body: 'User-agent: *\nDisallow: /\n', headers: { 'content-type': 'text/plain' } };

describe('redirects', () => {
  it('blocks a redirect to a host whose robots.txt disallows, before the target is requested', async () => {
    const { http, requested } = client({
      'https://a.example/robots.txt': OPEN_ROBOTS,
      'https://a.example/bids': { status: 301, headers: { location: 'https://b.example/bids' } },
      'https://b.example/robots.txt': CLOSED_ROBOTS,
      'https://b.example/bids': PAGE,
    });
    await expect(http.get('https://a.example/bids')).rejects.toMatchObject({ blocked: true, message: expect.stringContaining('robots.txt') });
    expect(requested).not.toContain('https://b.example/bids');
    expect(http.log.some((e) => e.redirectTo === 'https://b.example/bids')).toBe(true);
  });

  it('follows allowed redirects and reports the final address', async () => {
    const { http } = client({
      'https://a.example/robots.txt': OPEN_ROBOTS,
      'https://a.example/old': { status: 302, headers: { location: '/new' } },
      'https://a.example/new': PAGE,
    });
    await expect(http.get('https://a.example/old')).resolves.toMatchObject({ status: 200, url: 'https://a.example/new' });
  });

  it('stops a redirect loop', async () => {
    const { http } = client({
      'https://a.example/robots.txt': OPEN_ROBOTS,
      'https://a.example/x': { status: 301, headers: { location: '/y' } },
      'https://a.example/y': { status: 301, headers: { location: '/x' } },
    });
    await expect(http.get('https://a.example/x')).rejects.toThrow(/loop/);
  });

  it('stops after five redirects', async () => {
    const routes: Record<string, Route> = { 'https://a.example/robots.txt': OPEN_ROBOTS };
    for (let i = 0; i < 7; i += 1) routes[`https://a.example/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
    const { http, requested } = client(routes);
    await expect(http.get('https://a.example/0')).rejects.toThrow(/more than 5/);
    expect(requested.filter((u) => !u.endsWith('robots.txt'))).toHaveLength(6);
  });

  it('refuses a redirect to the cloud metadata address', async () => {
    const { http, requested } = client({
      'https://a.example/robots.txt': OPEN_ROBOTS,
      'https://a.example/bids': { status: 301, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
    });
    await expect(http.get('https://a.example/bids')).rejects.toBeInstanceOf(HttpError);
    expect(requested.some((u) => u.includes('169.254'))).toBe(false);
  });

  it('applies the same checks to streamed files', async () => {
    const { http, requested } = client({
      'https://a.example/robots.txt': OPEN_ROBOTS,
      'https://a.example/data.csv': { status: 301, headers: { location: 'https://b.example/data.csv' } },
      'https://b.example/robots.txt': CLOSED_ROBOTS,
      'https://b.example/data.csv': { status: 200, body: 'a,b' },
    });
    await expect(http.stream('https://a.example/data.csv')).rejects.toMatchObject({ blocked: true });
    expect(requested).not.toContain('https://b.example/data.csv');
  });
});

describe('robots.txt that cannot be read', () => {
  it('treats a 5xx robots.txt as disallow', async () => {
    const { http, requested } = client({ 'https://a.example/robots.txt': { status: 503 }, 'https://a.example/bids': PAGE });
    await expect(http.get('https://a.example/bids')).rejects.toMatchObject({ blocked: false, message: expect.stringContaining('robots.txt could not be read') });
    expect(requested).not.toContain('https://a.example/bids');
  });

  it('treats a robots.txt network failure as disallow', async () => {
    const { http } = client({ 'https://a.example/robots.txt': 'network-error', 'https://a.example/bids': PAGE });
    await expect(http.get('https://a.example/bids')).rejects.toMatchObject({ message: expect.stringContaining('could not be read') });
  });

  it('treats a missing robots.txt (404) as allow', async () => {
    const { http } = client({ 'https://a.example/bids': PAGE });
    await expect(http.get('https://a.example/bids')).resolves.toMatchObject({ status: 200 });
  });
});

describe('private addresses', () => {
  it('refuses a direct loopback address, and allows it with allowPrivate', async () => {
    const routes = { 'http://127.0.0.1:8080/robots.txt': OPEN_ROBOTS, 'http://127.0.0.1:8080/bids': PAGE };
    const strict = client(routes);
    await expect(strict.http.get('http://127.0.0.1:8080/bids')).rejects.toMatchObject({ blocked: true });
    expect(strict.requested).toHaveLength(0);
    const local = client(routes, { allowPrivate: true });
    await expect(local.http.get('http://127.0.0.1:8080/bids')).resolves.toMatchObject({ status: 200 });
  });

  it('refuses a host name that resolves to a private address', async () => {
    const { http, requested } = client({ 'https://intranet.example/bids': PAGE }, { lookup: async () => [{ address: '10.1.2.3', family: 4 }] });
    await expect(http.get('https://intranet.example/bids')).rejects.toBeInstanceOf(HttpError);
    expect(requested).toHaveLength(0);
  });

  it('never throws out of listSource', async () => {
    const { http } = client({});
    const source: SourceRecord = {
      id: 'local',
      name: 'Local',
      kind: 'html_list',
      enabled: true,
      builtin: false,
      notes: '',
      config: sourceConfigSchema.parse({ url: 'http://127.0.0.1:9/bids' }),
      lastRunAt: null,
      lastOkAt: null,
      lastStatus: 'never',
      lastMessage: '',
      lastItemCount: null,
      consecutiveFailures: 0,
      layoutWarning: '',
    };
    const outcome = await listSource(source, { http, now: new Date(), region: defaultRegion(), state: {}, note: () => undefined });
    expect(outcome.status).toBe('blocked');
    expect(outcome.message).toContain('private network');
  });

  it('classifies address ranges', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:7f00:1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '142.250.1.1', '172.32.0.1', '100.128.0.1', '2607:f8b0::1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('judges NAT64 and 6to4 addresses by the IPv4 address inside, and refuses site-local', () => {
    const inside = ['64:ff9b::a00:1', '64:ff9b::10.0.0.1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b:1::808:808', '2002:a00:1::1', '2002:7f00:1::', '2002:c0a8:101::5', 'fec0::1', 'feff::1', '::ffff:0:10.0.0.1', '0:0:0:0:0:ffff:a00:1', '[::ffff:127.0.0.1]'];
    for (const ip of inside) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['64:ff9b::808:808', '64:ff9b::8.8.8.8', '2002:808:808::1', '2002:8efa:101::']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('refuses a host whose DNS answer is a NAT64 or 6to4 form of a private address', async () => {
    const lookup: LookupFn = async () => [{ address: '64:ff9b::a9fe:a9fe', family: 6 }];
    const http = new HttpClient({ delayMs: 0, retries: 0, lookup, fetchImpl: (async () => new Response('x')) as typeof fetch });
    await expect(http.get('https://metadata.example/latest')).rejects.toThrow(/private network/);
  });
});

describe('fixed settings (D2)', () => {
  it('still refuses a disallowed path when the stored setting says respectRobots:false', async () => {
    const options = httpOptionsFor({ requestDelayMs: 0, respectRobots: false, userAgent: 'Mozilla/5.0' } as { requestDelayMs: number }, { demo: false });
    const web = fakeWeb({ 'https://a.example/robots.txt': CLOSED_ROBOTS, 'https://a.example/bids': PAGE });
    const http = new HttpClient({ ...options, respectRobots: false, retries: 0, lookup: publicLookup, fetchImpl: web.fetchImpl });
    await expect(http.get('https://a.example/bids')).rejects.toMatchObject({ blocked: true });
    expect(web.requested).not.toContain('https://a.example/bids');
  });

  it('always sends the fixed Lgbids user agent', async () => {
    expect(USER_AGENT).toMatch(/^Lgbids\/\d/);
    const { http, agents } = client({ 'https://a.example/bids': PAGE }, { userAgent: 'Mozilla/5.0 (pretend browser)' });
    await http.get('https://a.example/bids');
    expect(new Set(agents)).toEqual(new Set([USER_AGENT]));
  });
});
