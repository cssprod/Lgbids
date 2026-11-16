import nodemailer from 'nodemailer';
import type { Application, EmailSettings } from '../../shared/schemas.js';
import type { Mailer, MailerFactory, OutgoingMail } from '../contracts.js';
import { isEmail, parseEmailList } from '../util/text.js';

/**
 * Outgoing mail over the company's own SMTP account.
 *
 * Errors from the mail server are turned into one readable sentence because
 * they end up on the application page, where the user has to decide what to
 * fix. The SMTP password is scrubbed from anything we pass on.
 */

/** Most mail servers refuse messages much past 25 MB once encoded; base64 adds a third. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function emailConfigured(settings: EmailSettings): boolean {
  return !!settings.host && Number.isInteger(settings.port) && settings.port > 0 && isEmail(settings.fromEmail);
}

interface SmtpError extends Error {
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
  rejected?: string[];
}

function scrub(text: string, settings: EmailSettings): string {
  let out = text;
  if (settings.pass) out = out.split(settings.pass).join('********');
  return out.replace(/\s+/g, ' ').trim();
}

/** One plain sentence for whatever went wrong talking to the mail server. */
export function describeMailError(err: unknown, settings: EmailSettings): string {
  const e = (err ?? {}) as SmtpError;
  const code = e.code ?? '';
  const response = scrub(`${e.response ?? ''}`, settings);
  const message = scrub(`${e.message ?? String(err)}`, settings);
  const server = `${settings.host}:${settings.port}`;
  const said = response ? ` The server said: ${response.slice(0, 200)}` : '';

  if (e.responseCode === 552 || /\b(?:size|too (?:large|big))\b/i.test(response || message)) {
    return `The message is too large for the mail server. Remove some attachments or make them smaller.${said}`;
  }
  if (code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) {
    return `Authentication failed: the mail server at ${server} did not accept the user name and password.${said}`;
  }
  if (code === 'ENOAUTH') {
    return `The mail server at ${server} requires a login. Enter the SMTP user name and password.`;
  }
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(message)) {
    return `The connection to the mail server at ${server} timed out. Check the host and port, and that the server is reachable.`;
  }
  if (code === 'ETLS' || code === 'EREQUIRETLS' || /\b(?:TLS|SSL|certificate|wrong version number)\b/i.test(message)) {
    return `Could not set up a secure connection with the mail server at ${server}. Check the port and the "secure" setting (on for port 465, off for 587).`;
  }
  if (code === 'EENVELOPE' || (e.responseCode !== undefined && e.responseCode >= 550 && e.responseCode <= 553)) {
    const who = e.rejected?.length ? ` (${e.rejected.join(', ')})` : '';
    return `The mail server refused the recipient address${who}.${said}`;
  }
  if (code === 'ECONNECTION' || code === 'ESOCKET' || code === 'EDNS' || /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|EAI_AGAIN/.test(message)) {
    return `Could not connect to the mail server at ${server}. Check the host name and port.`;
  }
  return `The mail server reported an error: ${message.slice(0, 300)}`;
}

export const createMailer: MailerFactory = (settings: EmailSettings): Mailer => {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user ? { auth: { user: settings.user, pass: settings.pass } } : {}),
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });

  return {
    async verify() {
      try {
        await transport.verify();
      } catch (err) {
        throw new Error(describeMailError(err, settings));
      } finally {
        transport.close();
      }
    },
    async send(mail: OutgoingMail) {
      try {
        const info = await transport.sendMail({
          from: { name: settings.fromName || settings.fromEmail, address: settings.fromEmail },
          ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
          to: mail.to,
          cc: mail.cc,
          bcc: mail.bcc,
          subject: mail.subject,
          text: mail.text,
          attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
        });
        // With several recipients the server may accept the copy to ourselves
        // and refuse the buyer; that is not a submission, so treat it as failed.
        const rejected = ((info.rejected ?? []) as unknown[]).map((r) =>
          String(typeof r === 'object' && r !== null && 'address' in r ? r.address : r).toLowerCase(),
        );
        const missed = mail.to.filter((a) => rejected.includes(a.toLowerCase()));
        if (missed.length) throw Object.assign(new Error('Recipient refused'), { code: 'EENVELOPE', rejected: missed });
        return { messageId: String(info.messageId ?? '') };
      } catch (err) {
        throw new Error(describeMailError(err, settings));
      } finally {
        transport.close();
      }
    },
  };
};

export function buildSubmissionMail(args: {
  app: Application;
  settings: EmailSettings;
  attachments: OutgoingMail['attachments'];
}): OutgoingMail {
  const { app, settings, attachments } = args;
  const to = parseEmailList(app.toEmail);
  if (to.length === 0) throw new Error('The submission has no valid recipient address.');
  const cc = parseEmailList(app.ccEmail).filter((a) => !to.includes(a));
  const self = settings.fromEmail.trim().toLowerCase();
  // The copy to ourselves is the company's proof of what was sent and when.
  const bcc = settings.bccSelf && isEmail(self) && !to.includes(self) && !cc.includes(self) ? [self] : [];

  const total = attachments.reduce((sum, a) => sum + a.content.length, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    const mb = (total / (1024 * 1024)).toFixed(1);
    throw new Error(
      `The attachments add up to ${mb} MB, more than the 20 MB most mail servers accept. Remove some files or make them smaller.`,
    );
  }
  return { to, cc, bcc, subject: app.subject, text: app.body, attachments };
}
