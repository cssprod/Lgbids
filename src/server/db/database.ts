import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

/**
 * A thin wrapper over Node's built-in SQLite. Using the built-in module keeps
 * the app free of native add-ons, so `npm install` never needs a compiler.
 */

type Param = string | number | bigint | null | Uint8Array;
export type Params = Record<string, unknown> | unknown[];

function loadSqlite(): typeof import('node:sqlite') {
  // node:sqlite prints an ExperimentalWarning the first time it is loaded on
  // Node 22. It is stable enough for a single-user app; hide just that warning.
  const original = process.emitWarning;
  process.emitWarning = function patched(warning: string | Error, ...rest: unknown[]) {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (text.includes('SQLite is an experimental feature')) return;
    return (original as (...args: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  } finally {
    process.emitWarning = original;
  }
}

function clean(value: unknown): Param {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

export class Database {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;

  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const { DatabaseSync: Ctor } = loadSqlite();
    this.raw = new Ctor(path);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  }

  private statement(sql: string): StatementSync {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  private bind(params?: Params): [Record<string, Param>] | Param[] {
    if (!params) return [];
    if (Array.isArray(params)) return params.map(clean);
    const named: Record<string, Param> = {};
    for (const [key, value] of Object.entries(params)) named[key] = clean(value);
    return [named];
  }

  run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
    const result = this.statement(sql).run(...(this.bind(params) as Param[]));
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  get<T>(sql: string, params?: Params): T | undefined {
    const row = this.statement(sql).get(...(this.bind(params) as Param[]));
    return row ? ({ ...row } as T) : undefined;
  }

  all<T>(sql: string, params?: Params): T[] {
    return this.statement(sql)
      .all(...(this.bind(params) as Param[]))
      .map((row) => ({ ...row }) as T);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Run fn inside a transaction. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth += 1;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  close(): void {
    this.statements.clear();
    this.raw.close();
  }
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    builtin INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '{}',
    last_run_at TEXT,
    last_ok_at TEXT,
    last_status TEXT NOT NULL DEFAULT 'never',
    last_message TEXT NOT NULL DEFAULT '',
    last_item_count INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    ref_key TEXT NOT NULL DEFAULT '',
    title_key TEXT NOT NULL DEFAULT '',
    duplicate_of INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    organization TEXT NOT NULL DEFAULT '',
    reference_number TEXT NOT NULL DEFAULT '',
    notice_type TEXT NOT NULL DEFAULT 'OTHER',
    notice_type_hint TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    published_at TEXT,
    closes_at TEXT,
    closes_at_precision TEXT,
    closes_at_raw TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    categories TEXT NOT NULL DEFAULT '[]',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    documents TEXT NOT NULL DEFAULT '[]',
    document_text TEXT NOT NULL DEFAULT '',
    submission_method TEXT NOT NULL DEFAULT 'unknown',
    submission_email TEXT NOT NULL DEFAULT '',
    submission_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    bc_source INTEGER NOT NULL DEFAULT 0,
    suitability_score INTEGER,
    decision TEXT,
    user_decision TEXT,
    analysis TEXT,
    content_hash TEXT NOT NULL DEFAULT '',
    detail_fetched_at TEXT,
    documents_read_at TEXT,
    analysed_at TEXT,
    notified_at TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  );
  CREATE INDEX idx_opportunities_ref ON opportunities (ref_key) WHERE ref_key != '';
  CREATE INDEX idx_opportunities_title ON opportunities (title_key) WHERE title_key != '';
  CREATE INDEX idx_opportunities_status ON opportunities (status, decision);
  CREATE INDEX idx_opportunities_closes ON opportunities (closes_at);

  CREATE TABLE applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    channel TEXT NOT NULL,
    to_email TEXT NOT NULL DEFAULT '',
    cc_email TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    price_total REAL,
    price_notes TEXT NOT NULL DEFAULT '',
    include_rates INTEGER NOT NULL DEFAULT 0,
    checklist TEXT NOT NULL DEFAULT '[]',
    document_ids TEXT NOT NULL DEFAULT '[]',
    missing TEXT NOT NULL DEFAULT '[]',
    auto_generated INTEGER NOT NULL DEFAULT 1,
    edited_by_user INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT,
    submitted_via TEXT NOT NULL DEFAULT '',
    submission_ref TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    reminded_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_applications_status ON applications (status);

  CREATE TABLE application_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    expires_on TEXT NOT NULL DEFAULT '',
    attach_by_default INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    stats TEXT,
    error TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    level TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    opportunity_id INTEGER,
    application_id INTEGER,
    run_id INTEGER
  );
  CREATE INDEX idx_events_at ON events (at);

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  `,
];

/** Open the database file and bring its schema up to date. */
export function openDatabase(path: string): Database {
  const db = new Database(path);
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
  let version = row ? Number(row.value) : 0;
  while (version < MIGRATIONS.length) {
    const migration = MIGRATIONS[version]!;
    db.tx(() => {
      db.exec(migration);
      db.run("INSERT INTO meta (key, value) VALUES ('schema_version', :v) ON CONFLICT(key) DO UPDATE SET value = :v", { v: String(version + 1) });
    });
    version += 1;
  }
  return db;
}
