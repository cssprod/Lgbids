import type { Application, Opportunity, RunRecord } from '../../shared/schemas.js';
import type { AppDeps, OpportunityRecord } from '../contracts.js';
import { emailConfigured } from '../submission/email.js';
import { formatLocal, nowIso } from '../util/dates.js';
import { isEmail } from '../util/text.js';
import { PushError, pushConfigured, sendPush, type PushLine } from './push.js';

/**
 * The summary e-mail after a run: new suitable opportunities, drafts that
 * need the user, submissions sent automatically, and deadlines coming up.
 * One message per run at most, and only when there is something new, so it
 * stays worth opening.
 */

const REMINDER_KIND = 'deadline_reminder';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function closes(opp: Pick<Opportunity, 'closesAt' | 'closesAtPrecision'> | undefined, zone: string): string {
  if (!opp?.closesAt) return 'closing date not stated';
  return `closes ${formatLocal(opp.closesAt, opp.closesAtPrecision, zone)}`;
}

/** "Open in Lgbids" link, only when the user told us where the app is reached. */
function appLink(appUrl: string, path: string): string {
  return appUrl ? `\n  Open in Lgbids: ${appUrl}${path}` : '';
}

function oppLine(opp: OpportunityRecord, zone: string, appUrl = ''): string {
  const who = opp.organization ? ` — ${opp.organization}` : '';
  const score = opp.suitabilityScore !== null ? `, score ${opp.suitabilityScore}` : '';
  return `• ${opp.title}${who}\n  ${closes(opp, zone)}${score}\n  ${opp.url}${appLink(appUrl, `/opportunities/${opp.id}`)}`;
}

function appLine(app: Application, zone: string, extra = '', appUrl = ''): string {
  const opp = app.opportunity;
  const who = opp?.organization ? ` — ${opp.organization}` : '';
  return `• ${opp?.title ?? 'Untitled notice'}${who}\n  ${closes(opp, zone)}${extra}${appLink(appUrl, `/applications/${app.id}`)}`;
}

export async function sendDigest(deps: AppDeps, run: RunRecord): Promise<boolean> {
  const { store, settings } = deps;
  const zone = deps.config.timeZone;
  try {
    const automation = settings.getAutomation();
    const email = settings.getEmail();
    const to = automation.notifyEmail.trim();
    // The e-mail and the phone alert are separate choices; either one is enough to go on.
    const push = settings.getPush();
    // notifyOnNew only controls the new-bids section, not the whole e-mail.
    const emailOn = isEmail(to) && emailConfigured(email);
    const pushOn = pushConfigured(push);
    if (!emailOn && !pushOn) return false;
    const now = deps.now();

    // New suitable opportunities nobody has been told about yet.
    const fresh: OpportunityRecord[] = [];
    for (let offset = 0; automation.notifyOnNew; offset += 500) {
      const page = store.listOpportunities({ view: 'suitable', limit: 500, offset }, now);
      fresh.push(...page.items.filter((o) => o.notifiedAt === null));
      if (page.items.length < 500) break;
    }

    // What this run did is read back from its own activity entries, which
    // is exact even when two runs fall within the same second.
    const events = store.listEvents(1000);
    const ofThisRun = (kind: string) => new Set(events.filter((e) => e.runId === run.id && e.kind === kind).map((e) => e.applicationId));
    const drafted = ofThisRun('drafted');
    const sent = ofThisRun('sent');
    const needsInput = store.listApplications({ status: ['needs_input'] }).filter((a) => drafted.has(a.id));
    const readyToApprove = store.listApplications({ status: ['ready'] }).filter((a) => drafted.has(a.id) && a.channel === 'email');
    const autoSent = store.listApplications({ status: ['submitted'] }).filter((a) => sent.has(a.id) && a.submittedVia === 'auto-email');

    // Unsent submissions closing soon, each reminded once.
    const horizon = now.getTime() + automation.deadlineReminderDays * 86_400_000;
    const reminded = new Set(events.filter((e) => e.kind === REMINDER_KIND && e.applicationId !== null).map((e) => e.applicationId));
    const closingSoon =
      automation.notifyReminders && automation.deadlineReminderDays > 0
        ? store.listApplications({ status: ['ready', 'needs_input'] }).filter((a) => {
            const closesAt = a.opportunity?.closesAt;
            if (!closesAt || a.opportunity?.status !== 'open' || reminded.has(a.id)) return false;
            // The store tracks reminders too; whichever is available is honoured.
            if ((a as Application & { remindedAt?: string | null }).remindedAt) return false;
            const at = new Date(closesAt).getTime();
            return at > now.getTime() && at <= horizon;
          })
        : [];

    // Sites that listed notices before and none this run: told once, on the run that noticed.
    const changedSites = (run.stats?.sources ?? []).filter((s) => s.layoutWarning);

    if (fresh.length + needsInput.length + readyToApprove.length + autoSent.length + closingSoon.length + changedSites.length === 0) return false;

    const summary: string[] = [];
    if (fresh.length) summary.push(plural(fresh.length, 'new opportunity', 'new opportunities'));
    if (autoSent.length) summary.push(`${plural(autoSent.length, 'submission', 'submissions')} sent`);
    if (needsInput.length) summary.push(`${needsInput.length} ${needsInput.length === 1 ? 'needs' : 'need'} your input`);
    if (readyToApprove.length) summary.push(`${readyToApprove.length} ready to approve`);
    if (closingSoon.length) summary.push(`${closingSoon.length} closing soon`);
    if (changedSites.length) summary.push(`${plural(changedSites.length, 'source', 'sources')} to check`);
    const subject = `Lgbids: ${summary.join(', ')}`;
    const appUrl = automation.appUrl;

    const sections: string[] = ['Here is what the latest check of the bid sites found.'];
    if (fresh.length) sections.push(`New suitable opportunities:\n\n${fresh.map((o) => oppLine(o, zone, appUrl)).join('\n\n')}`);
    if (autoSent.length) {
      sections.push(
        `Sent automatically (a copy is in your sent mail):\n\n${autoSent.map((a) => appLine(a, zone, `\n  sent to ${a.toEmail}`, appUrl)).join('\n\n')}`,
      );
    }
    if (needsInput.length) {
      sections.push(
        `New drafts that need your input:\n\n${needsInput.map((a) => appLine(a, zone, a.missing.length ? `\n  still needed: ${a.missing.join(' ')}` : '', appUrl)).join('\n\n')}`,
      );
    }
    if (readyToApprove.length) sections.push(`New drafts ready for you to approve and send:\n\n${readyToApprove.map((a) => appLine(a, zone, '', appUrl)).join('\n\n')}`);
    if (closingSoon.length) {
      sections.push(`Closing soon and not yet submitted:\n\n${closingSoon.map((a) => appLine(a, zone, `\n  ${a.status === 'ready' ? 'ready to send' : 'needs your input'}`, appUrl)).join('\n\n')}`);
    }
    if (changedSites.length) sections.push(`Sources to check:\n\n${changedSites.map((s) => `• ${s.name}: ${s.layoutWarning}`).join('\n')}`);
    sections.push('Open Lgbids to review them. You can change or switch off these e-mails in Settings.');

    let emailSent = false;
    if (emailOn) {
      try {
        await deps.mailerFactory(email).send({ to: [to], cc: [], bcc: [], subject, text: `${sections.join('\n\n')}\n`, attachments: [] });
        emailSent = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.addEvent({ level: 'warn', kind: 'notify', message: `The summary e-mail to ${to} could not be sent: ${message}`, opportunityId: null, applicationId: null, runId: run.id }, now);
      }
    }
    // A short phone version of the same news; a failure is logged and never fails the run.
    const pushSent = pushOn && (await pushDigest(deps, run, { subject, fresh, autoSent, needsInput, readyToApprove, closingSoon }));
    if (!emailSent && !pushSent) return false;

    store.markNotified(
      fresh.map((o) => o.id),
      now,
    );
    for (const app of closingSoon) {
      store.updateApplication(app.id, { remindedAt: nowIso(now) }, now);
      store.addEvent(
        { level: 'info', kind: REMINDER_KIND, message: `Sent a reminder that “${app.opportunity?.title ?? 'Untitled notice'}” closes soon.`, opportunityId: app.opportunityId, applicationId: app.id, runId: run.id },
        now,
      );
    }
    if (emailSent) {
      store.addEvent({ level: 'info', kind: 'notify', message: `Sent the summary e-mail to ${to}: ${summary.join(', ')}.`, opportunityId: null, applicationId: null, runId: run.id }, now);
    }
    return true;
  } catch (error) {
    try {
      const message = error instanceof Error ? error.message : String(error);
      store.addEvent({ level: 'warn', kind: 'notify', message: `The summary e-mail could not be prepared: ${message}`, opportunityId: null, applicationId: null, runId: run.id }, deps.now());
    } catch {
      // Nothing more can be done; the run itself is unaffected.
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phone alert (Telegram or ntfy): the digest in a few lines
// ---------------------------------------------------------------------------

const PUSH_NOTICES = 5;
const PUSH_REMINDERS = 3;
const PROVIDER_NAME = { telegram: 'Telegram', ntfy: 'ntfy', off: 'phone' } as const;

interface DigestNews {
  subject: string;
  fresh: OpportunityRecord[];
  autoSent: Application[];
  needsInput: Application[];
  readyToApprove: Application[];
  closingSoon: Application[];
}

/** Send the short version of the digest; true when it went through. Failures become a warning in the activity log. */
async function pushDigest(deps: AppDeps, run: RunRecord, news: DigestNews): Promise<boolean> {
  const { store } = deps;
  const zone = deps.config.timeZone;
  const now = deps.now();
  const push = deps.settings.getPush();
  const via = PROVIDER_NAME[push.provider];
  const lines: PushLine[] = [];
  for (const opp of news.fresh.slice(0, PUSH_NOTICES)) {
    lines.push({ text: `${opp.title}${opp.organization ? ` — ${opp.organization}` : ''}, ${closes(opp, zone)}.`, url: opp.url });
  }
  if (news.fresh.length > PUSH_NOTICES) lines.push(`${plural(news.fresh.length - PUSH_NOTICES, 'more new opportunity is', 'more new opportunities are')} in Lgbids.`);
  if (news.autoSent.length) lines.push(`${plural(news.autoSent.length, 'submission was', 'submissions were')} sent automatically.`);
  if (news.needsInput.length) lines.push(`${plural(news.needsInput.length, 'new draft needs', 'new drafts need')} your input.`);
  if (news.readyToApprove.length) lines.push(`${plural(news.readyToApprove.length, 'new draft is', 'new drafts are')} ready to approve and send.`);
  for (const app of news.closingSoon.slice(0, PUSH_REMINDERS)) {
    lines.push(`Closing soon, not yet submitted: ${app.opportunity?.title ?? 'Untitled notice'}, ${closes(app.opportunity, zone)}.`);
  }
  if (news.closingSoon.length > PUSH_REMINDERS) lines.push(`${plural(news.closingSoon.length - PUSH_REMINDERS, 'more submission closes', 'more submissions close')} soon.`);

  try {
    await sendPush(push, { title: news.subject, lines }, deps.pushFetch);
    store.addEvent({ level: 'info', kind: 'notify', message: `Sent a phone alert through ${via}.`, opportunityId: null, applicationId: null, runId: run.id }, now);
    return true;
  } catch (error) {
    // Only our own sentences are repeated; anything else could carry an address with a token in it.
    const reason = error instanceof PushError ? error.message : 'Something went wrong while sending it.';
    store.addEvent({ level: 'warn', kind: 'notify', message: `The phone alert through ${via} could not be sent. ${reason}`, opportunityId: null, applicationId: null, runId: run.id }, now);
    return false;
  }
}
