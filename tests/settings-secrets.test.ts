import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/server/db/database.js';
import { createStore } from '../src/server/db/store.js';
import { createSettings } from '../src/server/settings.js';
import { createMailerWith, createMailer, type TransportFactory } from '../src/server/submission/email.js';
import { emailSettingsSchema, type EmailSettings } from '../src/shared/schemas.js';
import nodemailer from 'nodemailer';

function settings(store = createStore(openDatabase(':memory:')), env: NodeJS.ProcessEnv = {}) {
  return createSettings(store, env);
}

function mail(o: Partial<EmailSettings>): EmailSettings {
  return emailSettingsSchema.parse({ host: 'smtp.mail.example', port: 587, secure: false, fromEmail: 'bids@landscaping.example', ...o });
}

describe('saved passwords', () => {
  it('keeps a blank SMTP password only for the same host and user', () => {
    const s = settings();
    s.setEmail(mail({ user: 'bids', pass: 'secret-1' }));
    expect(s.setEmail(mail({ user: 'bids', pass: '' })).pass).toBe('secret-1');
    expect(s.setEmail(mail({ host: 'smtp.other.example', user: 'bids', pass: '' })).pass).toBe('');
    s.setEmail(mail({ user: 'bids', pass: 'secret-2' }));
    expect(s.setEmail(mail({ user: 'someone-else', pass: '' })).pass).toBe('');
  });

  it('drops the saved IMAP password when the host changes', () => {
    const s = settings();
    const base = s.getAlertInbox();
    s.setAlertInbox({ ...base, host: 'imap.mail.example', user: 'me', pass: 'imap-secret' });
    expect(s.setAlertInbox({ ...base, host: 'imap.mail.example', user: 'me', pass: '' }).pass).toBe('imap-secret');
    expect(s.setAlertInbox({ ...base, host: 'imap.evil.example', user: 'me', pass: '' }).pass).toBe('');
  });

  it('reads ALERT_IMAP_PASS, TELEGRAM_TOKEN and NTFY_TOKEN from the environment', () => {
    const s = settings(undefined, { ALERT_IMAP_PASS: 'env-imap', TELEGRAM_TOKEN: 'env-tg', NTFY_TOKEN: 'env-ntfy' });
    expect(s.getAlertInbox().pass).toBe('env-imap');
    expect(s.getPush()).toMatchObject({ telegramToken: 'env-tg', ntfyToken: 'env-ntfy' });
    expect(settings().getPush().telegramToken).toBe('');
  });
});

describe('mail transport TLS', () => {
  function spy() {
    const calls: Record<string, unknown>[] = [];
    const factory: TransportFactory = (options) => {
      calls.push(options as Record<string, unknown>);
      return nodemailer.createTransport({ jsonTransport: true });
    };
    return { calls, factory };
  }

  it('requires TLS when logging in to a remote server without implicit TLS', async () => {
    const { calls, factory } = spy();
    await createMailerWith(factory)(mail({ user: 'bids', pass: 'x' })).verify().catch(() => undefined);
    await createMailerWith(factory)(mail({ user: 'bids', pass: 'x', secure: true, port: 465 })).verify().catch(() => undefined);
    await createMailerWith(factory)(mail({ host: '127.0.0.1', user: 'bids', pass: 'x' })).verify().catch(() => undefined);
    await createMailerWith(factory)(mail({})).verify().catch(() => undefined);
    expect(calls.map((c) => c.requireTLS ?? false)).toEqual([true, false, false, false]);
  });

  describe('against a server without STARTTLS', () => {
    let server: SMTPServer;
    let port = 0;
    beforeAll(async () => {
      server = new SMTPServer({ authOptional: true, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false, onAuth: (_a, _s, cb) => cb(null, { user: 'bids' }) });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      port = (server.server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it('refuses to send the password and says why', async () => {
      const factory = createMailerWith((o) => nodemailer.createTransport(o), { plainLoopback: false });
      await expect(factory(mail({ host: '127.0.0.1', port, user: 'bids', pass: 'never-sent' })).verify()).rejects.toThrow(/does not offer a secure connection/);
    });

    it('still lets the local demo sink log in', async () => {
      await expect(createMailer(mail({ host: '127.0.0.1', port, user: 'bids', pass: 'demo' })).verify()).resolves.toBeUndefined();
    });
  });
});
