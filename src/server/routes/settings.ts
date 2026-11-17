import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ActionResult, AlertInboxView, EmailSettingsView, ProfileResponse } from '../../shared/api.js';
import { alertInboxSchema, automationSchema, emailSettingsSchema, profileSchema, regionSchema, type AlertInboxSettings, type EmailSettings } from '../../shared/schemas.js';
import { profileGaps } from '../applications/draft.js';
import { ALERT_SOURCE_ID, emailFromEnvironment } from '../settings.js';
import { emailConfigured } from '../submission/email.js';
import { nowIso } from '../util/dates.js';
import { isEmail } from '../util/text.js';
import { ApiError, parseBody, type RouteContext } from './util.js';

const testSchema = z.object({ to: z.string().trim().max(200).optional() });

function emailView(email: EmailSettings): EmailSettingsView {
  const { pass, ...rest } = email;
  return { ...rest, hasPassword: pass !== '', fromEnvironment: emailFromEnvironment(process.env) };
}

function inboxView(inbox: AlertInboxSettings): AlertInboxView {
  const { pass, ...rest } = inbox;
  return { ...rest, hasPassword: pass !== '' };
}

export function registerSettings(app: FastifyInstance, ctx: RouteContext): void {
  const { settings, store, now, mailerFactory, alertMailboxFactory } = ctx.deps;
  const { scheduler } = ctx;

  const profileResponse = (): ProfileResponse => {
    const profile = settings.getProfile();
    return { profile, missing: profileGaps(profile) };
  };

  app.get('/api/profile', async () => profileResponse());
  app.put('/api/profile', async (req) => {
    settings.setProfile(parseBody(profileSchema, req.body));
    return profileResponse();
  });

  app.get('/api/settings/automation', async () => settings.getAutomation());
  app.put('/api/settings/automation', async (req) => {
    const saved = settings.setAutomation(parseBody(automationSchema, req.body));
    scheduler.reschedule();
    return saved;
  });

  app.get('/api/settings/region', async () => settings.getRegion());
  app.put('/api/settings/region', async (req) => {
    const saved = settings.setRegion(parseBody(regionSchema, req.body));
    scheduler.reschedule();
    return saved;
  });
  app.post('/api/settings/region/reset', async () => {
    const saved = settings.resetRegion();
    scheduler.reschedule();
    return saved;
  });

  app.get('/api/settings/alert-inbox', async () => inboxView(settings.getAlertInbox()));
  app.put('/api/settings/alert-inbox', async (req) => {
    const value = parseBody(alertInboxSchema, req.body);
    const saved = settings.setAlertInbox({ ...value, verifiedAt: null });
    // Setting up the inbox is the moment the user wants the alerts read.
    if (saved.user && saved.pass) store.updateSource(ALERT_SOURCE_ID, { enabled: true }, now());
    return inboxView(saved);
  });
  app.post('/api/settings/alert-inbox/test', async (req): Promise<ActionResult> => {
    const inbox = settings.getAlertInbox();
    if (!inbox.user || !inbox.pass) {
      return { ok: false, message: 'The alert inbox is not set up yet. Enter the e-mail address and app password, then save.' };
    }
    try {
      const { count } = await alertMailboxFactory(inbox).test({ now: now(), lookbackDays: inbox.lookbackDays });
      settings.markAlertInboxVerified(now());
      const what = count === 1 ? '1 alert e-mail' : `${count} alert e-mails`;
      return {
        ok: true,
        message:
          count > 0
            ? `Connected. Found ${what} from BC Bid or Bonfire in “${inbox.folder}” from the last ${inbox.lookbackDays} days.`
            : `Connected, but there are no BC Bid or Bonfire e-mails in “${inbox.folder}” from the last ${inbox.lookbackDays} days yet. Check the folder name, or wait for the next alert.`,
      };
    } catch (err) {
      req.log.warn({ err }, 'alert inbox test failed');
      return { ok: false, message: err instanceof Error && err.message ? err.message : 'The mailbox could not be opened.' };
    }
  });

  app.get('/api/settings/email', async () => emailView(settings.getEmail()));
  app.put('/api/settings/email', async (req) => {
    const value = parseBody(emailSettingsSchema, req.body);
    const labels = { fromEmail: 'the address to send from', replyTo: 'the reply-to address' } as const;
    for (const field of ['fromEmail', 'replyTo'] as const) {
      if (value[field] && !isEmail(value[field])) throw new ApiError(400, `“${value[field]}” is not a valid e-mail address for ${labels[field]}.`);
    }
    // The form never sends the verification stamp; the settings service keeps it while the connection is unchanged.
    const { verifiedAt: _ignored, ...withoutStamp } = value;
    return emailView(settings.setEmail(withoutStamp));
  });

  app.post('/api/settings/email/test', async (req): Promise<ActionResult> => {
    const { to } = parseBody(testSchema, req.body);
    const email = settings.getEmail();
    if (!emailConfigured(email)) {
      return { ok: false, message: 'Outgoing e-mail is not set up yet. Enter the mail server, port and the address to send from, then save.' };
    }
    if (to && !isEmail(to)) return { ok: false, message: `“${to}” is not a valid e-mail address.` };
    const recipient = to || email.fromEmail;
    try {
      const mailer = mailerFactory(email);
      await mailer.verify();
      await mailer.send({
        to: [recipient],
        cc: [],
        bcc: [],
        subject: 'Lgbids test message',
        text: 'This is a test message from Lgbids. Your outgoing e-mail settings work, so e-mail submissions can be sent from this address.',
        attachments: [],
      });
    } catch (err) {
      req.log.warn({ err }, 'e-mail test failed');
      return { ok: false, message: err instanceof Error && err.message ? err.message : 'The test message could not be sent.' };
    }
    // Save the stamp on the stored values (not the SMTP_* overlay), so environment settings are not copied into the database.
    const stored = emailSettingsSchema.safeParse(store.getSetting('email') ?? {});
    const base = stored.success ? stored.data : emailSettingsSchema.parse({});
    settings.setEmail({ ...base, pass: '', verifiedAt: nowIso(now()) });
    return { ok: true, message: `A test message was sent to ${recipient}. Check that it arrived.` };
  });
}
