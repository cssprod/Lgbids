import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareDataDir, restrictDatabaseFiles, startServer } from '../src/server/bootstrap.js';
import { loadConfig } from '../src/server/config.js';
import { LOCK_FILE, LockHeldError, acquireLock, readLock } from '../src/server/util/lock.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lgbids-lock-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('single-instance lock', () => {
  it('is created with pid, port and start time, and removed on release', () => {
    const dir = tempDir();
    const lock = acquireLock(dir, { port: 3000, pid: 111, alive: () => true, now: new Date('2026-11-22T10:00:00Z') });
    expect(readLock(dir)).toEqual({ pid: 111, port: 3000, startedAt: '2026-11-22T10:00:00.000Z' });
    lock.update({ port: 3123, url: 'http://127.0.0.1:3123' });
    expect(readLock(dir)).toMatchObject({ port: 3123, url: 'http://127.0.0.1:3123' });
    lock.release();
    expect(readLock(dir)).toBeNull();
  });

  it('refuses a second start while the first process is alive, naming its address', () => {
    const dir = tempDir();
    acquireLock(dir, { port: 3000, pid: 111, alive: () => true }).update({ url: 'http://127.0.0.1:3000' });
    let error: unknown;
    try {
      acquireLock(dir, { port: 3001, pid: 222, alive: () => true });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(LockHeldError);
    expect((error as Error).message).toMatch(/already running .*http:\/\/127\.0\.0\.1:3000/);
  });

  it('takes over a lock left by a process that has gone', () => {
    const dir = tempDir();
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: 999_999, port: 3000, startedAt: '' }));
    const lock = acquireLock(dir, { port: 3002, pid: 333, alive: () => false });
    expect(readLock(dir)).toMatchObject({ pid: 333, port: 3002 });
    lock.release();
  });

  it('makes startServer refuse a data folder that another live server holds', async () => {
    const dir = tempDir();
    acquireLock(dir, { port: 3000, pid: process.ppid, alive: () => true }).update({ url: 'http://127.0.0.1:3000' });
    const config = { ...loadConfig({}), dataDir: dir, port: 0 };
    await expect(startServer(config)).rejects.toThrow(/already running/);
  });
});

describe.skipIf(process.platform === 'win32')('data-dir permissions', () => {
  it('makes the folder 0700 and the database 0600', () => {
    const dir = join(tempDir(), 'data');
    prepareDataDir(dir);
    writeFileSync(join(dir, 'lgbids.sqlite'), '', { mode: 0o644 });
    restrictDatabaseFiles(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'lgbids.sqlite')).mode & 0o777).toBe(0o600);
  });
});

describe('data-dir permissions on Windows', () => {
  it('leaves file modes alone', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'lgbids.sqlite'), '', { mode: 0o644 });
    restrictDatabaseFiles(dir, 'win32');
    if (process.platform !== 'win32') expect(statSync(join(dir, 'lgbids.sqlite')).mode & 0o777).toBe(0o644);
  });
});
