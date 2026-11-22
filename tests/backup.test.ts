import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackup, restoreBackup } from '../src/server/db/backup.js';
import { SCHEMA_VERSION, openDatabase } from '../src/server/db/database.js';
import { createStore } from '../src/server/db/store.js';
import { createFileStore } from '../src/server/files.js';
import { acquireLock } from '../src/server/util/lock.js';

const NOW = new Date('2026-11-22T10:15:00Z');
const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lgbids-backup-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('pre-migration snapshot and schema guard', () => {
  it('snapshots a schema-1 database before upgrading it', () => {
    const dir = tempDir();
    const path = join(dir, 'lgbids.sqlite');
    openDatabase(path, { upTo: 1 }).close();
    const db = openDatabase(path);
    const cols = db.all<{ name: string }>('PRAGMA table_info(sources)').map((c) => c.name);
    db.close();
    expect(cols.length).toBeGreaterThan(0);
    const snaps = readdirSync(join(dir, 'backups'));
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatch(/^lgbids-schema1-\d{8}T\d{6}Z\.sqlite$/);
    const snap = openDatabase(join(dir, 'backups', snaps[0]!), { upTo: 1 });
    expect(snap.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")?.value).toBe('1');
    snap.close();
  });

  it('refuses a database from a newer version', () => {
    const dir = tempDir();
    const path = join(dir, 'lgbids.sqlite');
    const db = openDatabase(path);
    db.run("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
    db.close();
    expect(() => openDatabase(path)).toThrow(new RegExp(`schema 99; this version knows up to ${SCHEMA_VERSION}.*restore`));
  });
});

describe('backup and restore', () => {
  it('brings back an opportunity and an uploaded file after the data is wiped', async () => {
    const dataDir = tempDir();
    const store = createStore(openDatabase(join(dataDir, 'lgbids.sqlite')));
    store.upsertOpportunity('src', { externalId: 'a', title: 'Boulevard mowing', url: 'https://town.example/a', location: '', status: 'open' }, false, NOW);
    const files = createFileStore(dataDir);
    const name = await files.save(Buffer.from('insurance certificate'), 'cert.pdf');
    store.close();

    const backup = createBackup(dataDir, NOW);
    expect(backup).toBe(join(dataDir, 'backups', '20261122T101500Z'));

    rmSync(join(dataDir, 'lgbids.sqlite'), { force: true });
    rmSync(join(dataDir, 'files'), { recursive: true, force: true });

    restoreBackup(dataDir, backup, new Date('2026-11-22T11:00:00Z'));
    const restored = createStore(openDatabase(join(dataDir, 'lgbids.sqlite')));
    expect(restored.listOpportunities({}, NOW).items.map((o) => o.title)).toContain('Boulevard mowing');
    restored.close();
    expect(readFileSync(join(dataDir, 'files', name), 'utf8')).toBe('insurance certificate');
    expect(existsSync(join(dataDir, 'backups', 'before-restore-20261122T110000Z'))).toBe(true);
  });

  it('refuses to restore while Lgbids holds the lock', () => {
    const dataDir = tempDir();
    openDatabase(join(dataDir, 'lgbids.sqlite')).close();
    const backup = createBackup(dataDir, NOW);
    acquireLock(dataDir, { port: 3000, pid: 4242, alive: () => true });
    expect(() => restoreBackup(dataDir, backup, NOW, () => true)).toThrow(/Stop it first/);
  });
});
