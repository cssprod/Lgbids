import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ActionResult, EmailSettingsView, ProfileResponse } from '../../shared/api.js';
import { automationSchema, emailSettingsSchema, profileSchema, regionSchema, type EmailSettings } from '../../shared/schemas.js';
import { profileGaps } from '../applications/draft.js';
import { emailFromEnvironment } from '../settings.js';
import { emailConfigured } from '../submission/email.js';
import { nowIso } from '../util/dates.js';
import { isEmail } from '../util/text.js';
import { parseBody, type RouteContext } from './util.js';

const testSchema = z.object({ to: z.string().trim().max(200).optional() });

function emailView(email: EmailSettings): EmailSettingsView {
  const { pass, ...rest } = email;
  return { ...rest, hasPassword: pass !== '', fromEnvironment: emailFromEnvironment(process.env) };
}

export function registerSettings(app: FastifyInstance, ctx: RouteContext): void {
  const { settings, store, now, mailerFactory } = ctx.deps;
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

  app.get('/api/settings/email', async () => emailView(settings.getEmail()));
  app.put('/api/settings/email', async (req) => {
    const value = parseBody(emailSettingsSchema, req.body);
    for (const field of ['fromEmail', 'replyTo'] as const) {
      if (value[field] && !isEmail(value[field])) {
        return parseBody(z.never(), undefined); // unreachable shape; replaced below for a clear sentence
      }
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
