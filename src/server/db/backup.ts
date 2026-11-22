import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { liveLock } from '../util/lock.js';
import { Database, backupStamp, vacuumInto } from './database.js';

/** Folders next to the database that a backup carries along. */
const FOLDERS = ['files', 'alert-inbox'] as const;
const DB_FILE = 'lgbids.sqlite';

/** A consistent copy of an open database, taken with VACUUM INTO. */
export function backupDatabase(db: Database, dest: string): void {
  vacuumInto(db, dest);
}

/**
 * `npm run backup`: write `DATA_DIR/backups/<stamp>/` with the database and copies
 * of the uploaded files and imported alert e-mails. Safe while Lgbids runs. The
 * copy holds saved passwords and tokens, so it is readable by the owner only.
 */
export function createBackup(dataDir: string, now: Date = new Date()): string {
  const source = join(dataDir, DB_FILE);
  if (!existsSync(source)) throw new Error(`There is no Lgbids database in ${dataDir} to back up.`);
  const dir = join(dataDir, 'backups', backupStamp(now));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
  const db = new Database(source);
  try {
    backupDatabase(db, join(dir, DB_FILE));
  } finally {
    db.close();
  }
  for (const folder of FOLDERS) {
    const from = join(dataDir, folder);
    if (existsSync(from)) cpSync(from, join(dir, folder), { recursive: true });
  }
  return dir;
}

/**
 * `npm run restore -- <dir>`: put a backup back. Refused while Lgbids runs on this
 * data folder, since the running server would keep writing to the old database.
 * What is there now is moved aside to `backups/before-restore-<stamp>/` first.
 */
export function restoreBackup(dataDir: string, backupDir: string, now: Date = new Date(), alive?: (pid: number) => boolean): string {
  const from = resolve(backupDir);
  if (!existsSync(join(from, DB_FILE))) throw new Error(`${from} is not a Lgbids backup: it has no ${DB_FILE}.`);
  const running = liveLock(dataDir, alive);
  if (running) {
    throw new Error(`Lgbids is running on this data folder (process ${running.pid}${running.url ? `, at ${running.url}` : ''}). Stop it first, then restore again.`);
  }
  const aside = join(dataDir, 'backups', `before-restore-${backupStamp(now)}`);
  mkdirSync(aside, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(dataDir)) {
    if (name === DB_FILE || name === `${DB_FILE}-wal` || name === `${DB_FILE}-shm` || (FOLDERS as readonly string[]).includes(name)) {
      renameSync(join(dataDir, name), join(aside, name));
    }
  }
  cpSync(join(from, DB_FILE), join(dataDir, DB_FILE));
  if (process.platform !== 'win32') chmodSync(join(dataDir, DB_FILE), 0o600);
  for (const folder of FOLDERS) {
    if (existsSync(join(from, folder))) cpSync(join(from, folder), join(dataDir, folder), { recursive: true });
  }
  return aside;
}

