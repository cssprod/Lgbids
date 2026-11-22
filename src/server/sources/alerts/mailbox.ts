import { ImapFlow } from 'imapflow';
import type { AlertInboxSettings } from '../../../shared/schemas.js';
import { ALERT_FROM_SEARCHES, alertSender, type AlertSender } from './parse.js';

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
  test(opts: { now: Date; lookbackDays: number }): Promise<{ count: number; /** Alert e-mails per sender, checked against the From header. */ bySender?: Partial<Record<AlertSender, number>> }>;
}

/** The alert services' sending domains, for Gmail's own search (same list as the Gmail filter in the setup guide). */
export const ALERT_SENDER_DOMAINS = [
  'bcbid.gov.bc.ca',
  'gobonfire.com',
  'bonfirehub.com',
  'bonfirehub.ca',
  'canadabuys.canada.ca',
  'bidsandtenders.ca',
  'merx.com',
  'biddingo.com',
];

/** Gmail's search: one X-GM-RAW query naming every sender domain. */
export function gmailFromQuery(): string {
  return `from:(${ALERT_SENDER_DOMAINS.join(' OR ')})`;
}

/**
 * Which UIDs to fetch and where to remember we stopped.
 * `found` is what the search returned; `resume` the last UID already read in
 * this folder (null on a first run or after UIDVALIDITY changed); `uidNext`
 * the folder's next UID.
 */
export function planFetch(found: number[], resume: number | null, max: number, uidNext: number | null): { uids: number[]; lastUid: number } {
  // "N:*" always matches the newest message, even when it is older than N.
  const uids = [...new Set(found)].filter((uid) => resume === null || uid > resume).sort((a, b) => a - b).slice(0, Math.max(0, max));
  if (uids.length > 0) return { uids, lastUid: uids[uids.length - 1]! };
  if (resume !== null) return { uids, lastUid: resume };
  // Nothing in the look-back window: start from now, not from the oldest mail in the folder.
  const lastUid = uidNext && uidNext > 0 ? uidNext - 1 : Math.max(0, ...found);
  return { uids, lastUid };
}

function isLoopback(host: string): boolean {
  return /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/i.test(host.trim());
}

type Envelope = { from?: { name?: string; address?: string }[] } | undefined;
function senderOf(envelope: Envelope): AlertSender | null {
  const from = (envelope?.from ?? []).map((a) => `${a.name ?? ''} <${a.address ?? ''}>`).join(', ');
  return from ? alertSender(from) : null;
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
  async function withFolder<T>(fn: (client: ImapFlow, uidValidity: string, uidNext: number | null) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      // Never send the password in clear text to a remote server.
      ...(!settings.secure && !isLoopback(settings.host) ? { doSTARTTLS: true } : {}),
      auth: { user: settings.user, pass: settings.pass },
      logger: false,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    try {
      await client.connect();
      const box = await client.mailboxOpen(settings.folder, { readOnly: true });
      return await fn(client, String(box.uidValidity), box.uidNext ? Number(box.uidNext) : null);
    } catch (err) {
      throw friendlyError(err, settings.folder);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  function fromQuery(client: ImapFlow, extra: Record<string, unknown>): Record<string, unknown> {
    // Gmail matches whole sender domains; elsewhere an OR of FROM substrings.
    if (client.capabilities?.has?.('X-GM-EXT-1')) return { ...extra, gmraw: gmailFromQuery() };
    return { ...extra, or: ALERT_FROM_SEARCHES.map((from) => ({ from })) };
  }

  return {
    async fetchNew(since, { now, lookbackDays, max }) {
      return withFolder(async (client, uidValidity, uidNext) => {
        const resume = since && since.uidValidity === uidValidity ? since.lastUid : null;
        const query =
          resume !== null
            ? fromQuery(client, { uid: `${resume + 1}:*` })
            : fromQuery(client, { since: new Date(now.getTime() - lookbackDays * 86_400_000) });
        const found = ((await client.search(query, { uid: true })) || []) as number[];
        const plan = planFetch(found, resume, max, uidNext);
        const messages: AlertMessage[] = [];
        if (plan.uids.length > 0) {
          for await (const msg of client.fetch(plan.uids, { source: true, uid: true, envelope: true }, { uid: true })) {
            // The server search is loose; keep only mail an alert sender really sent.
            if (msg.source && senderOf(msg.envelope as Envelope)) messages.push({ id: `imap:${msg.uid}`, raw: msg.source });
          }
        }
        return { messages, position: { uidValidity, lastUid: plan.lastUid } };
      });
    },

    async test({ now, lookbackDays }) {
      return withFolder(async (client) => {
        const found = ((await client.search(fromQuery(client, { since: new Date(now.getTime() - lookbackDays * 86_400_000) }), { uid: true })) || []) as number[];
        const bySender: Partial<Record<AlertSender, number>> = {};
        let count = 0;
        if (found.length > 0) {
          for await (const msg of client.fetch(found, { uid: true, envelope: true }, { uid: true })) {
            const sender = senderOf(msg.envelope as Envelope);
            if (!sender) continue;
            count += 1;
            bySender[sender] = (bySender[sender] ?? 0) + 1;
          }
        }
        return { count, bySender };
      });
    },
  };
}
