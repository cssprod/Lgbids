import type { Application, Opportunity, RunRecord } from '../../shared/schemas.js';
import type { AppDeps, OpportunityRecord } from '../contracts.js';
import { emailConfigured } from '../submission/email.js';
import { formatLocal, nowIso } from '../util/dates.js';
import { isEmail } from '../util/text.js';

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

function oppLine(opp: OpportunityRecord, zone: string): string {
  const who = opp.organization ? ` — ${opp.organization}` : '';
  const score = opp.suitabilityScore !== null ? `, score ${opp.suitabilityScore}` : '';
  return `• ${opp.title}${who}\n  ${closes(opp, zone)}${score}\n  ${opp.url}`;
}

function appLine(app: Application, zone: string, extra = ''): string {
  const opp = app.opportunity;
  const who = opp?.organization ? ` — ${opp.organization}` : '';
  return `• ${opp?.title ?? 'Untitled notice'}${who}\n  ${closes(opp, zone)}${extra}`;
}

export async function sendDigest(deps: AppDeps, run: RunRecord): Promise<boolean> {
  const { store, settings } = deps;
  const zone = deps.config.timeZone;
  try {
    const automation = settings.getAutomation();
    const email = settings.getEmail();
    const to = automation.notifyEmail.trim();
    if (!automation.notifyOnNew || !isEmail(to) || !emailConfigured(email)) return false;
    const now = deps.now();

    // New suitable opportunities nobody has been told about yet.
    const fresh: OpportunityRecord[] = [];
    for (let offset = 0; ; offset += 500) {
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
      automation.deadlineReminderDays > 0
        ? store.listApplications({ status: ['ready', 'needs_input'] }).filter((a) => {
            const closesAt = a.opportunity?.closesAt;
            if (!closesAt || a.opportunity?.status !== 'open' || reminded.has(a.id)) return false;
            // The store tracks reminders too; whichever is available is honoured.
            if ((a as Application & { remindedAt?: string | null }).remindedAt) return false;
            const at = new Date(closesAt).getTime();
            return at > now.getTime() && at <= horizon;
          })
        : [];

    if (fresh.length + needsInput.length + readyToApprove.length + autoSent.length + closingSoon.length === 0) return false;

    const summary: string[] = [];
    if (fresh.length) summary.push(plural(fresh.length, 'new opportunity', 'new opportunities'));
    if (autoSent.length) summary.push(`${plural(autoSent.length, 'submission', 'submissions')} sent`);
    if (needsInput.length) summary.push(`${needsInput.length} ${needsInput.length === 1 ? 'needs' : 'need'} your input`);
    if (readyToApprove.length) summary.push(`${readyToApprove.length} ready to approve`);
    if (closingSoon.length) summary.push(`${closingSoon.length} closing soon`);
    const subject = `Lgbids: ${summary.join(', ')}`;

    const sections: string[] = ['Here is what the latest check of the bid sites found.'];
    if (fresh.length) sections.push(`New suitable opportunities:\n\n${fresh.map((o) => oppLine(o, zone)).join('\n\n')}`);
    if (autoSent.length) {
      sections.push(
        `Sent automatically (a copy is in your sent mail):\n\n${autoSent.map((a) => appLine(a, zone, `\n  sent to ${a.toEmail}`)).join('\n\n')}`,
      );
    }
    if (needsInput.length) {
      sections.push(
        `New drafts that need your input:\n\n${needsInput.map((a) => appLine(a, zone, a.missing.length ? `\n  still needed: ${a.missing.join(' ')}` : '')).join('\n\n')}`,
      );
    }
    if (readyToApprove.length) sections.push(`New drafts ready for you to approve and send:\n\n${readyToApprove.map((a) => appLine(a, zone)).join('\n\n')}`);
    if (closingSoon.length) {
      sections.push(`Closing soon and not yet submitted:\n\n${closingSoon.map((a) => appLine(a, zone, `\n  ${a.status === 'ready' ? 'ready to send' : 'needs your input'}`)).join('\n\n')}`);
    }
    sections.push('Open Lgbids to review them. You can change or switch off these e-mails in Settings.');

    try {
      await deps.mailerFactory(email).send({ to: [to], cc: [], bcc: [], subject, text: `${sections.join('\n\n')}\n`, attachments: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.addEvent({ level: 'warn', kind: 'notify', message: `The summary e-mail to ${to} could not be sent: ${message}`, opportunityId: null, applicationId: null, runId: run.id }, now);
      return false;
    }

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
    store.addEvent({ level: 'info', kind: 'notify', message: `Sent the summary e-mail to ${to}: ${summary.join(', ')}.`, opportunityId: null, applicationId: null, runId: run.id }, now);
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
