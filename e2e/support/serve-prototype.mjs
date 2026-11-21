// Serves the built prototype (dist/prototype) the way Netlify does: the
// security headers from `_headers` and the single-page fallback from
// `_redirects`, so the e2e tests see the same CSP as the hosted beta.
//
//   node e2e/support/serve-prototype.mjs [folder]   (port: $E2E_PROTO_PORT, default 4318)
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../dist/prototype', import.meta.url)));
const port = Number(process.env.E2E_PROTO_PORT || 4318);
const host = '127.0.0.1';

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No prototype build in ${root}. Run \`npm run build:prototype\` first.`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Netlify path pattern ("/*", "/assets/*", "/exact") as a test. */
function pathMatcher(pattern) {
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1);
    return (path) => path.startsWith(prefix) || path === prefix.slice(0, -1);
  }
  return (path) => path === pattern;
}

/** `_headers`: a path line, then indented "Name: value" lines. */
function readHeaders() {
  const file = join(root, '_headers');
  if (!existsSync(file)) return [];
  const rules = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ matches: pathMatcher(line.trim()), headers: [] });
      continue;
    }
    const at = line.indexOf(':');
    if (at > 0 && rules.length) rules[rules.length - 1].headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return rules;
}

/** `_redirects`: "from to [status]"; only 200 rewrites and 30x redirects are needed here. */
function readRedirects() {
  const file = join(root, '_redirects');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [from, to, status = '301'] = l.split(/\s+/);
      return { matches: pathMatcher(from), to, status: Number.parseInt(status, 10) };
    });
}

const headerRules = readHeaders();
const redirects = readRedirects();

function fileFor(path) {
  const candidate = normalize(join(root, decodeURIComponent(path)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  for (const f of [candidate, join(candidate, 'index.html')]) {
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', `http://${host}`).pathname;
  for (const rule of headerRules) if (rule.matches(path)) for (const [name, value] of rule.headers) res.setHeader(name, value);

  // Netlify Forms accepts the POST; the e2e tests only need the redirect to the thank-you page.
  if (req.method === 'POST') {
    req.resume();
    res.writeHead(303, { location: '/feedback-sent.html' }).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  let file = fileFor(path);
  let status = 200;
  if (!file) {
    const rule = redirects.find((r) => r.matches(path));
    if (rule && rule.status >= 300 && rule.status < 400) {
      res.writeHead(rule.status, { location: rule.to }).end();
      return;
    }
    if (rule) {
      file = fileFor(rule.to);
      status = rule.status;
    }
  }
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found\n');
    return;
  }
  res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
});

server.listen(port, host, () => console.log(`Prototype served from ${root} on http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
