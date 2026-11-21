import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import type { SourceRecord } from '../../../shared/schemas.js';
import { alertSender, parseAlertEmail } from '../alerts/parse.js';
import type { AlertMessage, MailboxPosition } from '../alerts/mailbox.js';
import type { Connector, ConnectorContext, ListResult, RawOpportunity } from '../types.js';

/**
 * The "Bid alert e-mails" source: BC Bid and Bonfire alerts read from the
 * user's mailbox (read-only) and from .eml files imported on the Sources page.
 */

const MAX_MESSAGES = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

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
    let skipped = 0;
    for (const m of messages) {
      const mail = await simpleParser(m.raw, { skipImageLinks: true, skipTextToHtml: true }).catch(() => null);
      const from = mail?.from?.text ?? '';
      if (!mail || !alertSender(from)) {
        skipped += 1;
        continue;
      }
      const found = parseAlertEmail(
        { from, subject: mail.subject ?? '', html: typeof mail.html === 'string' ? mail.html : '', text: mail.text ?? '', date: mail.date ?? null },
        { zone: 'America/Vancouver', now: ctx.now },
      );
      if (found.length === 0) skipped += 1;
      items.push(...found);
    }

    if (alerts.consume && files.length > 0) {
      const done = join(alerts.importDir, 'read');
      await mkdir(done, { recursive: true });
      for (const f of files) await rename(f.path, join(done, f.name)).catch(() => undefined);
    }

    const parts = [inboxNote];
    if (files.length > 0) parts.push(`${files.length} imported ${files.length === 1 ? 'file' : 'files'}`);
    parts.push(`${items.length} ${items.length === 1 ? 'notice' : 'notices'} found`);
    if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? 'e-mail' : 'e-mails'} skipped (not a recognised alert)`);
    ctx.note(`${parts.join('; ')}.`);
    return { items, state };
  },
};
