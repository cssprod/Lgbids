import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildFixtures } from './fixtures.js';

export interface FixtureServer {
  url: string;
  /** Paths requested so far, in order (used by tests). */
  requests: string[];
  close(): Promise<void>;
}

/**
 * Serve the invented sample bid sites on a local port. Used by demo mode and
 * by the tests; it only ever listens on 127.0.0.1.
 */
export async function startFixtureServer(now: Date = new Date(), port = 0): Promise<FixtureServer> {
  const requests: string[] = [];
  let fixtures: Awaited<ReturnType<typeof buildFixtures>> | null = null;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push(`${url.pathname}${url.search}`);
    const found = fixtures?.(url.pathname, url.searchParams) ?? null;
    if (!found) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const etag = found.headers?.etag;
    if (etag && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return;
    }
    res.writeHead(found.status ?? 200, { 'content-type': found.type, ...found.headers });
    res.end(found.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  fixtures = await buildFixtures(now, url);

  return {
    url,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
