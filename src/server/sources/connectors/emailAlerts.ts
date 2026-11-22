import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import type { SourceRecord } from '../../../shared/schemas.js';
import { nowIso } from '../../util/dates.js';
import { readAlertEmail } from '../alerts/parse.js';
import type { AlertMessage, MailboxPosition } from '../alerts/mailbox.js';
import type { Connector, ConnectorContext, ListResult, RawOpportunity } from '../types.js';

/**
 * The "Bid alert e-mails" source: BC Bid and Bonfire alerts read from the
 * user's mailbox (read-only) and from .eml files imported on the Sources page.
 */

const MAX_MESSAGES = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** How many unrecognised inbox e-mails are remembered for a bug report. */
const MAX_SKIPPED = 20;
/** Imported files that held no notice are moved here, so they can be checked later. */
export const UNRECOGNISED_DIR = 'unrecognised';

/** An inbox e-mail that was not read as an alert, kept (headers only) so the format can be fixed. */
export interface SkippedAlert {
  uid: string;
  from: string;
  subject: string;
  date: string | null;
}

/** One saved alert e-mail, read: who sent it, what it says, and the notices in it. */
export interface ReadAlertFile {
  from: string;
  subject: string;
  date: Date | null;
  items: RawOpportunity[];
}

/** Read one raw e-mail (an .eml file or an inbox message). Never opens a link. */
export async function readAlertMessage(raw: Buffer, now: Date): Promise<ReadAlertFile | null> {
  const mail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true }).catch(() => null);
  if (!mail) return null;
  const from = mail.from?.text ?? '';
  const subject = mail.subject ?? '';
  const date = mail.date ?? null;
  const reading = readAlertEmail(
    { from, subject, html: typeof mail.html === 'string' ? mail.html : '', text: mail.text ?? '', date },
    { zone: 'America/Vancouver', now },
  );
  return { from, subject, date, items: reading.items };
}

function skippedFrom(state: Record<string, unknown>): SkippedAlert[] {
  return Array.isArray(state.skipped) ? (state.skipped as SkippedAlert[]) : [];
}

function positionFrom(state: Record<string, unknown>): MailboxPosition | null {
  const p = state.position as Partial<MailboxPosition> | undefined;
  return p && typeof p.uidValidity === 'string' && typeof p.lastUid === 'number' ? { uidValidity: p.uidValidity, lastUid: p.lastUid } : null;
}

async function importedFiles(dir: string): Promise<{ name: string; path: string }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files: { name: string; path: string }[] = [];
  for (const name of names.filter((n) => /\.eml$/i.test(n)).sort()) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && info.size <= MAX_FILE_BYTES) files.push({ name, path });
  }
  return files.slice(0, MAX_MESSAGES);
}

export const emailAlerts: Connector = {
  kind: 'email_alerts',
  // Only alert e-mails newer than the saved position are returned.
  incremental: true,

  async list(_source: SourceRecord, ctx: ConnectorContext): Promise<ListResult> {
    const alerts = ctx.alerts;
    if (!alerts) throw new Error('Bid alert e-mails can only be read by the app itself.');
    const messages: AlertMessage[] = [];
    let state = ctx.state;
    let inboxNote = '';

    if (alerts.mailbox) {
      const since = alerts.consume ? positionFrom(ctx.state) : null;
      const batch = await alerts.mailbox.fetchNew(since, { now: ctx.now, lookbackDays: alerts.lookbackDays, max: MAX_MESSAGES });
      messages.push(...batch.messages);
      if (alerts.consume) state = { ...ctx.state, position: batch.position };
      inboxNote = `${batch.messages.length} new alert ${batch.messages.length === 1 ? 'e-mail' : 'e-mails'} in the inbox`;
    } else {
      inboxNote = 'No alert inbox is set up';
    }

    const files = await importedFiles(alerts.importDir);
    for (const f of files) messages.push({ id: f.name, raw: await readFile(f.path) });

    const items: RawOpportunity[] = [];
    const fileNotices = new Map<string, number>();
    const skippedMail: SkippedAlert[] = [];
    let skipped = 0;
    for (const m of messages) {
      const read = await readAlertMessage(m.raw, ctx.now);
      const found = read?.items ?? [];
      if (found.length === 0) {
        skipped += 1;
        if (m.id.startsWith('imap:')) {
          skippedMail.push({ uid: m.id.slice(5), from: read?.from ?? '', subject: read?.subject ?? '', date: read?.date ? nowIso(read.date) : null });
        }
      }
      fileNotices.set(m.id, found.length);
      items.push(...found);
    }
    if (skippedMail.length > 0) state = { ...state, skipped: [...skippedFrom(state), ...skippedMail].slice(-MAX_SKIPPED) };

    // A file with no notice is kept apart, not filed as read, so it can go into a bug report.
    if (alerts.consume && files.length > 0) {
      const done = join(alerts.importDir, 'read');
      const unrecognised = join(alerts.importDir, UNRECOGNISED_DIR);
      for (const f of files) {
        const target = (fileNotices.get(f.name) ?? 0) > 0 ? done : unrecognised;
        await mkdir(target, { recursive: true });
        await rename(f.path, join(target, f.name)).catch(() => undefined);
      }
    }

    const parts = [inboxNote];
    if (files.length > 0) parts.push(`${files.length} imported ${files.length === 1 ? 'file' : 'files'}`);
    parts.push(`${items.length} ${items.length === 1 ? 'notice' : 'notices'} found`);
    if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? 'e-mail' : 'e-mails'} skipped (${skipped} not recognised — kept for a bug report)`);
    ctx.note(`${parts.join('; ')}.`);
    return { items, state };
  },
};
