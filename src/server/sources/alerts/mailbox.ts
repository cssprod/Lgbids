import { ImapFlow } from 'imapflow';
import type { AlertInboxSettings } from '../../../shared/schemas.js';
import { ALERT_FROM_SEARCHES } from './parse.js';

/**
 * Read-only access to the mailbox that receives bid alerts.
 *
 * The folder is opened read-only (IMAP EXAMINE), so nothing is marked as read,
 * moved or deleted, and only messages whose From line mentions an alert
 * sender are fetched: the rest of the mailbox is never downloaded.
 */

export interface AlertMessage {
  /** Where it came from, for the activity log: "imap:1234" or a file name. */
  id: string;
  raw: Buffer;
}

export interface MailboxPosition {
  uidValidity: string;
  lastUid: number;
}

export interface AlertMailbox {
  /** Messages after `since` (or from the last `lookbackDays` when there is no position yet), oldest first. */
  fetchNew(since: MailboxPosition | null, opts: { now: Date; lookbackDays: number; max: number }): Promise<{ messages: AlertMessage[]; position: MailboxPosition | null }>;
  /** Sign in, open the folder and count the alert e-mails from the last `lookbackDays`. */
  test(opts: { now: Date; lookbackDays: number }): Promise<{ count: number }>;
}

const TIMEOUT_MS = 60_000;

function friendlyError(err: unknown, folder: string): Error {
  const e = err as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string; mailboxMissing?: boolean };
  if (e?.authenticationFailed) {
    return new Error('The mail server did not accept the user name and password. For Gmail, use an app password, not your normal password.');
  }
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') return new Error('The mail server address could not be found.');
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET') return new Error('The mail server could not be reached. Check the address and port.');
  if (/nonexistent|not exist|unknown mailbox|no such mailbox/i.test(`${e?.responseText ?? ''} ${e?.message ?? ''}`) || e?.mailboxMissing) {
    return new Error(`The folder “${folder}” was not found in this mailbox. For a Gmail label, use the label’s name.`);
  }
  return new Error(`The mail server answered with an error: ${e?.responseText || e?.message || 'unknown error'}.`);
}

export function createImapMailbox(settings: AlertInboxSettings): AlertMailbox {
  async function withFolder<T>(fn: (client: ImapFlow, uidValidity: string) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: settings.pass },
      logger: false,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    try {
      await client.connect();
      const box = await client.mailboxOpen(settings.folder, { readOnly: true });
      return await fn(client, String(box.uidValidity));
    } catch (err) {
      throw friendlyError(err, settings.folder);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  function fromQuery(extra: Record<string, unknown>): Record<string, unknown> {
    return { ...extra, or: ALERT_FROM_SEARCHES.map((from) => ({ from })) };
  }

  return {
    async fetchNew(since, { now, lookbackDays, max }) {
      return withFolder(async (client, uidValidity) => {
        const resume = since && since.uidValidity === uidValidity ? since.lastUid : null;
        const query =
          resume !== null ? fromQuery({ uid: `${resume + 1}:*` }) : fromQuery({ since: new Date(now.getTime() - lookbackDays * 86_400_000) });
        const found = ((await client.search(query, { uid: true })) || []) as number[];
        // "N:*" always matches the newest message, even when it is older than N.
        const uids = found.filter((uid) => resume === null || uid > resume).sort((a, b) => a - b).slice(0, max);
        const messages: AlertMessage[] = [];
        if (uids.length > 0) {
          for await (const msg of client.fetch(uids, { source: true, uid: true }, { uid: true })) {
            if (msg.source) messages.push({ id: `imap:${msg.uid}`, raw: msg.source });
          }
        }
        const lastUid = uids.length > 0 ? uids[uids.length - 1]! : (resume ?? Math.max(0, ...found));
        return { messages, position: { uidValidity, lastUid } };
      });
    },

    async test({ now, lookbackDays }) {
      return withFolder(async (client) => {
        const found = ((await client.search(fromQuery({ since: new Date(now.getTime() - lookbackDays * 86_400_000) }), { uid: true })) || []) as number[];
        return { count: found.length };
      });
    },
  };
}
