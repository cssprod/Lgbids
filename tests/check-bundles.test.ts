import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = new URL('../scripts/check-bundles.mjs', import.meta.url).pathname;
const appSource = readFileSync(new URL('../src/server/app.ts', import.meta.url), 'utf8');
const serverCsp = /'content-security-policy':\s*"([^"]+)"/.exec(appSource)![1]!;
const protoCsp = serverCsp.replace("img-src 'self' data:", "img-src 'self' data: blob:");
const MARKERS = "const k='lgbids-prototype-v1'; function handleMock(){} const PrototypeBar=1; import('./prototypePdf-x.js'); 'beta-feedback'";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function build(opts: { webJs?: string; protoJs?: string; csp?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lgbids-bundles-'));
  dirs.push(root);
  const web = join(root, 'web');
  const proto = join(root, 'prototype');
  for (const d of [web, proto]) {
    mkdirSync(join(d, 'assets'), { recursive: true });
    writeFileSync(join(d, 'index.html'), '<!doctype html><div id="root"></div>');
  }
  writeFileSync(join(web, 'assets', 'index-abc.js'), opts.webJs ?? 'console.log("app")');
  writeFileSync(join(proto, 'assets', 'index-def.js'), opts.protoJs ?? MARKERS);
  writeFileSync(join(proto, '_headers'), `/*\n  Content-Security-Policy: ${opts.csp ?? protoCsp}\n  X-Robots-Tag: noindex\n`);
  const res = spawnSync(process.execPath, [script, web, proto], { encoding: 'utf8' });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

describe('check-bundles', () => {
  it('passes a clean app next to a complete prototype', () => {
    const r = build();
    expect(r.output).toContain('Bundle check passed');
    expect(r.status).toBe(0);
  });

  it('fails when prototype code reaches the real app', () => {
    const r = build({ webJs: 'function handleMock(){}' });
    expect(r.status).toBe(1);
    expect(r.output).toContain('"handleMock" is in the real app');
  });

  it('fails when the prototype lacks its markers, so the check cannot pass by accident', () => {
    const r = build({ protoJs: 'console.log("empty")' });
    expect(r.status).toBe(1);
    expect(r.output).toContain('"PrototypeBar" is missing from the prototype');
  });

  it('fails when the prototype CSP drifts from the server CSP', () => {
    expect(build({ csp: serverCsp }).status).toBe(1);
    const r = build({ csp: `${protoCsp}; script-src 'self' 'unsafe-eval'` });
    expect(r.status).toBe(1);
    expect(r.output).toContain('prototype CSP differs');
  });
});
