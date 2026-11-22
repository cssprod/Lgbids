import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { displayUrl, isLoopback, timeZoneWarning } from '../src/server/bootstrap.js';
import { checkSources } from '../src/server/cli/checkSources.js';
import { runOnce } from '../src/server/cli/runOnce.js';
import { loadConfig } from '../src/server/config.js';
import type { AppDeps, Pipeline } from '../src/server/contracts.js';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('start-up', () => {
  it('refuses to listen beyond this computer without APP_PASSWORD', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, HOST: '0.0.0.0', PORT: '39871', DATA_DIR: ':memory:' };
    delete env.APP_PASSWORD;
    delete env.ALLOW_NO_PASSWORD;
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no APP_PASSWORD is set/);
  }, 35_000);

  it('knows which hosts are loopback', () => {
    for (const h of ['127.0.0.1', '127.8.9.10', 'localhost', '::1', '[::1]', ' LOCALHOST ']) expect(isLoopback(h)).toBe(true);
    for (const h of ['0.0.0.0', '::', '192.168.1.5', 'example.com', '128.0.0.1']) expect(isLoopback(h)).toBe(false);
  });

  it('shows a browser address for every-interface and IPv6 hosts', () => {
    const base = loadConfig({});
    expect(displayUrl({ ...base, host: '0.0.0.0' }, 3000)).toBe('http://localhost:3000');
    expect(displayUrl({ ...base, host: '::' }, 3000)).toBe('http://localhost:3000');
    expect(displayUrl({ ...base, host: '::1' }, 8080)).toBe('http://[::1]:8080');
    expect(displayUrl({ ...base, host: '127.0.0.1' }, 3001)).toBe('http://127.0.0.1:3001');
  });

  it('warns about old time zone data only when January is still UTC−8', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    expect(timeZoneWarning(now, -480)).toMatch(/outdated time zone data/);
    expect(timeZoneWarning(now, -420)).toBeNull();
  });
});

function fakeDeps(sources: { name: string; enabled: boolean }[]): AppDeps {
  return {
    store: { listSources: () => sources },
    settings: { getAutomation: () => ({ mode: 'prepare' }) },
  } as unknown as AppDeps;
}

describe('command-line tools', () => {
  it('check-sources exits 1 when a source errors or is blocked', async () => {
    const lines: string[] = [];
    const statuses: Record<string, string> = { A: 'ok', B: 'blocked' };
    const pipeline = {
      testSource: async (s: { name: string }) => ({ status: statuses[s.name], count: 1, ms: 5, message: 'done', sample: [] }),
    } as unknown as Pipeline;
    const deps = fakeDeps([{ name: 'A', enabled: true }, { name: 'B', enabled: true }, { name: 'C', enabled: false }]);
    expect(await checkSources(deps, pipeline, (l) => lines.push(l))).toBe(1);
    expect(lines.join('\n')).toMatch(/1 of 2 sources failed or were blocked/);
    statuses.B = 'ok';
    expect(await checkSources(deps, pipeline, () => undefined)).toBe(0);
    expect(await checkSources(fakeDeps([]), pipeline, () => undefined)).toBe(0);
  });

  it('run-once exits 1 when the run or a source fails', async () => {
    const source = (status: string) => ({ name: 'Saanich', status, found: 2, added: 1, message: '' });
    const totals = { found: 2, added: 1, analysed: 1, suitable: 1, drafted: 0, sent: 0, expired: 0 };
    const make = (status: string, sourceStatus: string) =>
      ({ run: async () => ({ id: 1, status, error: null, stats: { ...totals, sources: [source(sourceStatus)] } }) }) as unknown as Pipeline;
    const deps = fakeDeps([]);
    const lines: string[] = [];
    expect(await runOnce(deps, make('ok', 'ok'), (l) => lines.push(l))).toBe(0);
    expect(lines.join('\n')).toMatch(/Found 2, new 1/);
    expect(await runOnce(deps, make('ok', 'error'), () => undefined)).toBe(1);
    expect(await runOnce(deps, make('ok', 'blocked'), () => undefined)).toBe(1);
    expect(await runOnce(deps, make('error', 'ok'), () => undefined)).toBe(1);
  });
});
