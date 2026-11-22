import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// The launcher is plain JavaScript (it must run before anything is installed), so it is loaded untyped.
interface Launcher {
  isSupportedNode(version: string): boolean;
  appUrl(env: Record<string, string | undefined>): string;
  browserCommand(platform: string, url: string): { command: string; args: string[]; verbatim: boolean };
  installReason(root: string): string;
  buildReason(root: string): string;
  readEnvFile(path: string, env: Record<string, string | undefined>): Record<string, string | undefined>;
  lockUrl(dataDir: string, alive?: (pid: number) => boolean): string | null;
}

let launch: Launcher;
const dirs: string[] = [];

beforeAll(async () => {
  const path: string = new URL('../scripts/launch.mjs', import.meta.url).href;
  launch = (await import(path)) as Launcher;
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lgbids-launch-'));
  dirs.push(dir);
  return dir;
}

function touch(root: string, path: string, when: Date): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, '');
  utimesSync(full, when, when);
}

const older = new Date('2026-07-01T12:00:00Z');
const newer = new Date('2026-07-02T12:00:00Z');

describe('launcher', () => {
  it('accepts Node.js 22.13 and newer only', () => {
    expect(launch.isSupportedNode('22.12.0')).toBe(false);
    expect(launch.isSupportedNode('20.19.1')).toBe(false);
    expect(launch.isSupportedNode('22.13.0')).toBe(true);
    expect(launch.isSupportedNode('v24.1.0')).toBe(true);
  });

  it('opens the address the server listens on, using loopback for every-interface hosts', () => {
    expect(launch.appUrl({})).toBe('http://127.0.0.1:3000/');
    expect(launch.appUrl({ HOST: '0.0.0.0', PORT: '4100' })).toBe('http://127.0.0.1:4100/');
    expect(launch.appUrl({ HOST: '::' })).toBe('http://[::1]:3000/');
    expect(launch.appUrl({ HOST: 'localhost', PORT: ' 8080 ' })).toBe('http://localhost:8080/');
  });

  it('uses the platform browser opener', () => {
    expect(launch.browserCommand('win32', 'http://127.0.0.1:3000/')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '""', 'http://127.0.0.1:3000/'],
      verbatim: true,
    });
    expect(launch.browserCommand('darwin', 'u').command).toBe('open');
    expect(launch.browserCommand('linux', 'u').command).toBe('xdg-open');
  });

  it('installs when node_modules is missing or older than the lock file', () => {
    const root = tempRoot();
    touch(root, 'package-lock.json', newer);
    expect(launch.installReason(root)).toBe('missing');
    touch(root, 'node_modules/.package-lock.json', older);
    expect(launch.installReason(root)).toBe('outdated');
    touch(root, 'node_modules/.package-lock.json', newer);
    expect(launch.installReason(root)).toBe('');
  });

  it('builds when the build is missing or older than the sources', () => {
    const root = tempRoot();
    touch(root, 'package.json', older);
    touch(root, 'src/server/index.ts', older);
    expect(launch.buildReason(root)).toBe('missing');
    touch(root, 'dist/server/index.js', newer);
    touch(root, 'dist/web/index.html', newer);
    expect(launch.buildReason(root)).toBe('');
    touch(root, 'src/web/pages/Today.tsx', new Date('2026-07-03T12:00:00Z'));
    expect(launch.buildReason(root)).toBe('outdated');
  });

  it('reads a .env file without overriding variables that are already set', () => {
    const root = tempRoot();
    writeFileSync(join(root, '.env'), 'PORT=4100\nHOST=127.0.0.1\n');
    const env = launch.readEnvFile(join(root, '.env'), { PORT: '5000' });
    expect(env.PORT).toBe('5000');
    expect(env.HOST).toBe('127.0.0.1');
    expect(launch.readEnvFile(join(root, 'missing.env'), { A: '1' })).toEqual({ A: '1' });
  });

  it("takes the running instance's address from its lock file", () => {
    const dir = mkdtempSync(join(tmpdir(), 'lgbids-launch-lock-'));
    dirs.push(dir);
    expect(launch.lockUrl(dir)).toBeNull();
    writeFileSync(join(dir, 'lgbids.lock'), JSON.stringify({ pid: 4242, port: 3100, startedAt: '', url: 'http://127.0.0.1:3100' }));
    expect(launch.lockUrl(dir, () => true)).toBe('http://127.0.0.1:3100/');
    expect(launch.lockUrl(dir, () => false)).toBeNull();
  });
});
