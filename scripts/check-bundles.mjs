// Guards the line between the real app and the hosted prototype:
//   1. no prototype code in the real app's bundle (dist/web),
//   2. the same markers ARE in dist/prototype, so the check cannot pass by
//      looking at the wrong folder or an empty build,
//   3. the prototype's Netlify CSP is the server's CSP plus `blob:` in img-src
//      (the prototype builds its downloads in the browser).
//
//   node scripts/check-bundles.mjs [webDir] [prototypeDir]
// Run after `npm run build && npm run build:prototype`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const webDir = process.argv[2] ?? join(repo, 'dist/web');
const protoDir = process.argv[3] ?? join(repo, 'dist/prototype');

// `inPrototype: false` marks a marker the prototype does not ship yet; it is
// still forbidden in dist/web. Flip it to true when the feature lands.
const MARKERS = [
  { marker: 'lgbids-prototype-', inPrototype: true }, // localStorage key, any version
  { marker: 'beta-feedback', inPrototype: true }, // Netlify feedback form
  { marker: 'notice-feedback', inPrototype: true }, // per-notice Netlify form (UX-16)
  { marker: 'handleMock', inPrototype: true }, // in-browser sample API
  { marker: 'PrototypeBar', inPrototype: true }, // tester bar
  { marker: 'prototypePdf', inPrototype: true }, // in-browser PDF downloads
];

const problems = [];

function filesUnder(dir, keep) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path, keep));
    else if (keep(entry.name)) out.push(path);
  }
  return out;
}

/** Marker → files (by name or content) that contain it. */
function scan(files) {
  const hits = new Map(MARKERS.map(({ marker }) => [marker, []]));
  for (const file of files) {
    const text = `${file}\n${readFileSync(file, 'utf8')}`;
    for (const { marker } of MARKERS) if (text.includes(marker)) hits.get(marker).push(file);
  }
  return hits;
}

// 1. The real app.
const webJs = filesUnder(webDir, (name) => name.endsWith('.js'));
if (!existsSync(join(webDir, 'index.html')) || webJs.length === 0) {
  problems.push(`No built app in ${webDir}. Run \`npm run build\` first.`);
} else {
  for (const [marker, files] of scan(webJs)) {
    for (const f of files) problems.push(`Prototype code "${marker}" is in the real app: ${relative(repo, f)}.`);
  }
}

// 2. The prototype.
const protoFiles = filesUnder(protoDir, (name) => /\.(?:js|html)$/.test(name));
if (!existsSync(join(protoDir, 'index.html')) || protoFiles.length === 0) {
  problems.push(`No prototype build in ${protoDir}. Run \`npm run build:prototype\` first.`);
} else {
  const hits = scan(protoFiles);
  for (const { marker, inPrototype } of MARKERS) {
    if (inPrototype && hits.get(marker).length === 0) problems.push(`"${marker}" is missing from the prototype, so this check would prove nothing.`);
  }
}

// 3. CSP parity.
function directives(csp) {
  const map = new Map();
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name.toLowerCase(), [...new Set(values)].sort());
  }
  return map;
}

function same(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (JSON.stringify(b.get(k)) !== JSON.stringify(v)) return false;
  return true;
}

const appSource = readFileSync(join(repo, 'src/server/app.ts'), 'utf8');
const cspMatch = /'content-security-policy':\s*(?:"([^"]+)"|`([^`]+)`)/.exec(appSource);
const serverCsp = cspMatch?.[1] ?? cspMatch?.[2];
const headersFile = join(protoDir, '_headers');
const protoCsp = existsSync(headersFile) ? /^\s*Content-Security-Policy:\s*(.+)$/im.exec(readFileSync(headersFile, 'utf8'))?.[1]?.trim() : undefined;
if (!serverCsp) problems.push('Could not find the server CSP in src/server/app.ts.');
else if (!protoCsp) problems.push(`No Content-Security-Policy in ${relative(repo, headersFile)}.`);
else {
  const expected = directives(serverCsp);
  expected.set('img-src', [...new Set([...(expected.get('img-src') ?? []), 'blob:'])].sort());
  if (!same(expected, directives(protoCsp))) {
    problems.push(`The prototype CSP differs from the server CSP plus blob: in img-src.\n    server:    ${serverCsp}\n    prototype: ${protoCsp}`);
  }
}

if (problems.length) {
  console.error(`Bundle check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Bundle check passed: ${webJs.length} app scripts are free of prototype code, the prototype has its markers, and the CSPs match.`);
