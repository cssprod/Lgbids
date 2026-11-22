import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { alertInboxSchema, type AlertInboxSettings } from '../../shared/schemas.js';
import { loadConfig } from '../config.js';
import { defaultRegion } from '../matching/geo.js';
import { createImapMailbox, type AlertMailbox } from '../sources/alerts/mailbox.js';
import { candidateProbes, createLiveCheckHttp, PORTAL_PROBES, recordsFrom, runLiveCheck } from '../sources/liveCheck.js';
import { DEFAULT_SOURCES } from '../sources/registry.js';

/**
 * `npm run live-check -- [--include-blocked] [--save-html] [--alerts] [--eml <dir>] [--only <id,id>] [--out <dir>]`
 *
 * Reads every built-in source once (on or off), probes the unconfirmed buyer
 * pages and the portal robots.txt files, and writes
 * `live-check-YYYY-MM-DD/report.md` and `bundle.json` to send back. It never
 * writes the app's database: the sources live in memory, and the saved
 * alert-inbox settings are read from the database opened read-only.
 */

export interface LiveCheckArgs {
  includeBlocked: boolean;
  saveHtml: boolean;
  alerts: boolean;
  eml: string | null;
  only: string[];
  out: string | null;
}

export function parseArgs(argv: string[]): LiveCheckArgs {
  const args: LiveCheckArgs = { includeBlocked: false, saveHtml: false, alerts: false, eml: null, only: [], out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value.`);
      i += 1;
      return v;
    };
    if (a === '--include-blocked') args.includeBlocked = true;
    else if (a === '--save-html') args.saveHtml = true;
    else if (a === '--alerts') args.alerts = true;
    else if (a === '--eml') args.eml = value();
    else if (a === '--only') args.only = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') args.out = value();
    else throw new Error(`Unknown option ${a}. Options: --include-blocked, --save-html, --alerts, --eml <dir>, --only <id,id>, --out <dir>.`);
  }
  return args;
}

/** The saved alert-inbox settings, read from the app's database opened read-only (nothing else is read). */
export function readSavedInbox(dataDir: string, env: NodeJS.ProcessEnv = process.env): AlertInboxSettings | null {
  const path = join(dataDir, 'lgbids.sqlite');
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'alertInbox'").get() as { value?: string } | undefined;
    if (!row?.value) return null;
    const inbox = alertInboxSchema.parse(JSON.parse(row.value));
    const pass = env.ALERT_IMAP_PASS;
    return pass ? { ...inbox, pass } : inbox;
  } finally {
    db.close();
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, out: (line: string) => void = console.log): Promise<number> {
  const args = parseArgs(argv);
  const config = loadConfig(env);
  const now = new Date();

  let mailbox: AlertMailbox | null = null;
  let lookbackDays = 30;
  if (args.alerts) {
    const inbox = readSavedInbox(config.dataDir, env);
    if (!inbox?.user || !inbox.pass) {
      out('No alert inbox is set up (Settings → Bid alert inbox), so --alerts has nothing to read.');
      return 1;
    }
    mailbox = createImapMailbox(inbox);
    lookbackDays = inbox.lookbackDays;
  }

  const defs = args.only.length ? DEFAULT_SOURCES.filter((d) => args.only.includes(d.id)) : DEFAULT_SOURCES;
  const { http, recorder } = createLiveCheckHttp({ allowPrivate: false });
  const { bundle, report } = await runLiveCheck({
    http,
    recorder,
    now,
    region: defaultRegion(),
    sources: recordsFrom(defs, now),
    candidates: args.only.length ? [] : candidateProbes(),
    portals: args.only.length ? [] : PORTAL_PROBES,
    includeBlocked: args.includeBlocked,
    saveHtml: args.saveHtml,
    mailbox,
    lookbackDays,
    emlDir: args.eml ? resolve(args.eml) : undefined,
    progress: out,
  });

  const dir = resolve(args.out ?? `live-check-${DateTime.fromJSDate(now).setZone(config.timeZone).toISODate()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.md'), report);
  writeFileSync(join(dir, 'bundle.json'), JSON.stringify(bundle));
  out(`\nWrote ${join(dir, 'report.md')} and bundle.json. Read both, then send them back.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
