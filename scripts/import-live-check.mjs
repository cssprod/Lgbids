#!/usr/bin/env node
// Unpack a live-check bundle into test fixtures:
//   node scripts/import-live-check.mjs <bundle.json | live-check folder> [repo root]
// `live/<id>/…` files go to tests/fixtures/live/<id>/, `alerts/…` files to
// tests/fixtures/alerts/. Paths are checked so a bundle cannot write anywhere
// else, and a file that still holds an address outside `.example` is refused.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAFE = /^(?:live\/[a-z0-9][a-z0-9._-]{0,80}\/[a-z0-9][a-z0-9._-]{0,80}\.html|alerts\/[a-z0-9][a-z0-9._-]{0,80}\.eml)$/;
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8})/g;

/** Where each bundle file goes, relative to the repository root; null when the path is not allowed. */
export function targetFor(path) {
  if (typeof path !== 'string' || !SAFE.test(path) || path.includes('..')) return null;
  return path.startsWith('live/') ? join('tests', 'fixtures', path) : join('tests', 'fixtures', 'alerts', path.slice('alerts/'.length));
}

export function hasForeignAddress(text) {
  for (const m of text.matchAll(EMAIL)) if (!/\.example$/i.test(m[1])) return true;
  return false;
}

/** Write the bundle's files under `root`; returns what was written and what was refused. */
export function importBundle(bundle, root) {
  const written = [];
  const refused = [];
  if (!bundle || bundle.version !== 1 || !Array.isArray(bundle.files)) throw new Error('This is not a live-check bundle (version 1).');
  for (const file of bundle.files) {
    const target = targetFor(file?.path);
    if (!target || typeof file.content !== 'string') {
      refused.push({ path: String(file?.path), reason: 'path not allowed' });
      continue;
    }
    if (hasForeignAddress(file.content)) {
      refused.push({ path: file.path, reason: 'holds an e-mail address outside .example' });
      continue;
    }
    const full = join(root, target);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, file.content);
    written.push(target);
  }
  return { written, refused };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, rootArg] = process.argv.slice(2);
  if (!input) {
    console.error('Usage: node scripts/import-live-check.mjs <bundle.json | live-check folder> [repo root]');
    process.exit(2);
  }
  let path = resolve(input);
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'bundle.json');
  const root = resolve(rootArg ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  try {
    const { written, refused } = importBundle(JSON.parse(readFileSync(path, 'utf8')), root);
    for (const w of written) console.log(`wrote ${w}`);
    for (const r of refused) console.log(`skipped ${r.path}: ${r.reason}`);
    console.log(`${written.length} files written, ${refused.length} skipped.`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
