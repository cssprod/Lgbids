import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = 'lgbids.lock';

export interface LockInfo {
  pid: number;
  port: number;
  startedAt: string;
  /** The address a browser on this computer can open, once the server listens. */
  url?: string;
}

export interface InstanceLock {
  path: string;
  /** Record the real port and address once the server listens. */
  update(info: Partial<LockInfo>): void;
  release(): void;
}

export class LockHeldError extends Error {
  constructor(readonly info: LockInfo) {
    const where = info.url ?? `port ${info.port}`;
    super(`Lgbids is already running with this data folder (process ${info.pid}, at ${where}). Open that address, or stop it before starting another copy.`);
    this.name = 'LockHeldError';
  }
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readLock(dataDir: string): LockInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, LOCK_FILE), 'utf8')) as Partial<LockInfo>;
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null;
    return { pid: parsed.pid, port: parsed.port, startedAt: String(parsed.startedAt ?? ''), ...(parsed.url ? { url: String(parsed.url) } : {}) };
  } catch {
    return null;
  }
}

/** The running instance's lock, or null when there is none or its process has gone. */
export function liveLock(dataDir: string, alive: (pid: number) => boolean = pidAlive): LockInfo | null {
  const info = readLock(dataDir);
  return info && alive(info.pid) ? info : null;
}

/**
 * Take the single-instance lock for `dataDir`. Two servers on one database would
 * run checks and sends twice, so a live lock stops the second start. A lock left
 * by a process that has gone (a crash or power cut) is taken over.
 */
export function acquireLock(
  dataDir: string,
  opts: { port: number; pid?: number; now?: Date; alive?: (pid: number) => boolean },
): InstanceLock {
  const path = join(dataDir, LOCK_FILE);
  let info: LockInfo = { pid: opts.pid ?? process.pid, port: opts.port, startedAt: (opts.now ?? new Date()).toISOString() };
  const alive = opts.alive ?? pidAlive;
  const write = (flag: 'wx' | 'w') => {
    writeFileSync(path, JSON.stringify(info), { flag, mode: 0o600 });
  };
  for (let attempt = 0; ; attempt++) {
    try {
      write('wx');
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw err;
      const held = readLock(dataDir);
      if (held && held.pid !== info.pid && alive(held.pid)) throw new LockHeldError(held);
      // Stale (or unreadable) lock: remove it and try once more, still exclusively.
      try {
        unlinkSync(path);
      } catch {
        // Someone else removed it first; the retry decides.
      }
    }
  }
  let released = false;
  return {
    path,
    update(next) {
      if (released) return;
      info = { ...info, ...next };
      write('w');
      if (process.platform !== 'win32') chmodSync(path, 0o600);
    },
    release() {
      if (released) return;
      released = true;
      // Only remove our own lock, never one another process took over.
      if (existsSync(path) && readLock(dataDir)?.pid === info.pid) unlinkSync(path);
    },
  };
}
