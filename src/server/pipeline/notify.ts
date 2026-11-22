import type { Application, Opportunity, RunRecord } from '../../shared/schemas.js';
import type { AppDeps, OpportunityRecord } from '../contracts.js';
import { emailConfigured } from '../submission/email.js';
import { formatLocal } from '../util/dates.js';
import { isEmail } from '../util/text.js';
import { PushError, pushConfigured, sendPush, type PushLine } from './push.js';
import { notifyChanges, watchedChangesOfRun } from './watch.js';

/**
 * The summary e-mail after a run: new suitable opportunities, drafts that
 * need the user and submissions sent automatically, led by changes to bids
 * the user is pursuing when change e-mails are on. Closing reminders have
 * their own tick (reminders.ts). One message per run at most, and only when
 * there is something new besides changes (each change has its own alert),
 * so it stays worth opening. No change is e-mailed twice.
 */

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
  // Changes listed in a summary e-mail that went out; their own alert then goes by push only.
  const emailedChanges = new Set<number>();
  try {
    return await sendSummary(deps, run, emailedChanges);
  } finally {
    // One message per change (push, and e-mail when asked and not already in the summary); it never fails the run.
    await notifyChanges(deps, deps.now(), emailedChanges);
  }
}

async function sendSummary(deps: AppDeps, run: RunRecord, emailedChanges: Set<number>): Promise<boolean> {
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
    const now = deps.now();
    // This run's changes to bids the user is watching; collected before the alerts mark them as told.
    const watched = watchedChangesOfRun(store, run.id);
    const changedIds = new Set(watched.map((c) => c.opp.id));
    // Changes lead the summary only when "Changes to bids you pursue" is on. They
    // never make a summary on their own: each has its own alert.
    const changes = automation.notifyChanges && emailOn ? watched : [];
    if (!emailOn && !pushOn) return false;

    // New suitable opportunities nobody has been told about yet.
    const fresh: OpportunityRecord[] = [];
    // Changed this run, so told about as a change, not again as new; marked as told with the summary.
    const toldAsChange: number[] = [];
    for (let offset = 0; automation.notifyOnNew; offset += 500) {
      const page = store.listOpportunities({ view: 'suitable', limit: 500, offset }, now);
      for (const o of page.items) {
        if (o.notifiedAt !== null) continue;
        if (changedIds.has(o.id)) toldAsChange.push(o.id);
        else fresh.push(o);
      }
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

    // Sites that listed notices before and none this run: told once, on the run that noticed.
    const changedSites = (run.stats?.sources ?? []).filter((s) => s.layoutWarning);

    if (fresh.length + needsInput.length + readyToApprove.length + autoSent.length + changedSites.length === 0) return false;

    const summary: string[] = [];
    if (changes.length) summary.push(plural(changes.length, 'change to a bid you are pursuing', 'changes to bids you are pursuing'));
    if (fresh.length) summary.push(plural(fresh.length, 'new opportunity', 'new opportunities'));
    if (autoSent.length) summary.push(`${plural(autoSent.length, 'submission', 'submissions')} sent`);
    if (needsInput.length) summary.push(`${needsInput.length} ${needsInput.length === 1 ? 'needs' : 'need'} your input`);
    if (readyToApprove.length) summary.push(`${readyToApprove.length} ready to approve`);
    if (changedSites.length) summary.push(`${plural(changedSites.length, 'source', 'sources')} to check`);
    const subject = `Lgbids: ${summary.join(', ')}`;
    const appUrl = automation.appUrl;

    const sections: string[] = ['Here is what the latest check of the bid sites found.'];
    if (changes.length) {
      sections.push(
        `Changes to bids you are pursuing:\n\n${changes
          .map(({ change, opp }) => `• ${opp.title}${opp.organization ? ` — ${opp.organization}` : ''}\n  ${change.summary}${appLink(appUrl, opp.application ? `/applications/${opp.application.id}` : `/opportunities/${opp.id}`)}`)
          .join('\n\n')}`,
      );
    }
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
    if (changedSites.length) sections.push(`Sources to check:\n\n${changedSites.map((s) => `• ${s.name}: ${s.layoutWarning}`).join('\n')}`);
    sections.push('Open Lgbids to review them. You can change or switch off these e-mails in Settings.');

    let emailSent = false;
    if (emailOn) {
      try {
        await deps.mailerFactory(email).send({ to: [to], cc: [], bcc: [], subject, text: `${sections.join('\n\n')}\n`, attachments: [] });
        emailSent = true;
        for (const { change } of changes) emailedChanges.add(change.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.addEvent({ level: 'warn', kind: 'notify', message: `The summary e-mail to ${to} could not be sent: ${message}`, opportunityId: null, applicationId: null, runId: run.id }, now);
      }
    }
    // A short phone version of the same news; a failure is logged and never fails the run.
    // Changes already had a phone alert each, so the short version leaves them out.
    const pushNews = fresh.length + autoSent.length + needsInput.length + readyToApprove.length > 0;
    const pushSent = pushOn && pushNews && (await pushDigest(deps, run, { subject, fresh, autoSent, needsInput, readyToApprove }));
    if (!emailSent && !pushSent) return false;

    store.markNotified([...fresh.map((o) => o.id), ...toldAsChange], now);
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
// One alert about one bid (reminders and changes), on every channel that is set up
// ---------------------------------------------------------------------------

export interface BidAlert {
  /** Short title, also the e-mail subject after "Lgbids: ". */
  title: string;
  /** Full sentences. */
  lines: string[];
  /** The notice on the buyer's site, for the phone alert. */
  url: string;
  /** Path inside Lgbids for the "Open in Lgbids" link, e.g. /opportunities/4. */
  path: string;
  /** Send the e-mail copy too (the matching Notifications switch is on). */
  email: boolean;
  opportunityId: number;
  applicationId: number | null;
  /** What the alert is about, for warnings in the activity log, e.g. "closing reminder". */
  what: string;
}

/**
 * Send one alert by push (when phone alerts are set up) and by e-mail (when
 * asked and an address and SMTP are set). Returns the channels that went
 * through and how many were tried; failures become warnings in the activity log and never throw.
 */
export async function deliverAlert(deps: AppDeps, alert: BidAlert, now: Date): Promise<{ channels: string[]; tried: number }> {
  const { store, settings } = deps;
  const channels: string[] = [];
  let tried = 0;
  const warn = (message: string) => {
    try {
      store.addEvent({ level: 'warn', kind: 'notify', message, opportunityId: alert.opportunityId, applicationId: alert.applicationId, runId: null }, now);
    } catch {
      // The log is a courtesy here; the alert result still stands.
    }
  };
  const automation = settings.getAutomation();
  const appUrl = automation.appUrl;

  const push = settings.getPush();
  if (pushConfigured(push)) {
    const via = PROVIDER_NAME[push.provider];
    tried += 1;
    try {
      const lines: PushLine[] = [...alert.lines];
      if (appUrl) lines.push({ text: 'Open in Lgbids', url: `${appUrl}${alert.path}` });
      await sendPush(push, { title: alert.title, lines, url: alert.url || undefined }, deps.pushFetch);
      channels.push('push');
    } catch (error) {
      const reason = error instanceof PushError ? error.message : 'Something went wrong while sending it.';
      warn(`The ${alert.what} through ${via} could not be sent. ${reason}`);
    }
  }

  const to = automation.notifyEmail.trim();
  const email = settings.getEmail();
  if (alert.email && isEmail(to) && emailConfigured(email)) {
    tried += 1;
    try {
      const text = `${alert.lines.join('\n\n')}\n\n${alert.url ? `The notice: ${alert.url}\n` : ''}${appLink(appUrl, alert.path).trim() ? `${appLink(appUrl, alert.path).trim()}\n` : ''}\nYou can switch these e-mails off in Settings, or for this bid on its page.\n`;
      await deps.mailerFactory(email).send({ to: [to], cc: [], bcc: [], subject: `Lgbids: ${alert.title}`, text, attachments: [] });
      channels.push('email');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`The ${alert.what} e-mail to ${to} could not be sent: ${message}`);
    }
  }
  return { channels, tried };
}

// ---------------------------------------------------------------------------
// Phone alert (Telegram or ntfy): the digest in a few lines
// ---------------------------------------------------------------------------

const PUSH_NOTICES = 5;
const PROVIDER_NAME = { telegram: 'Telegram', ntfy: 'ntfy', off: 'phone' } as const;

interface DigestNews {
  subject: string;
  fresh: OpportunityRecord[];
  autoSent: Application[];
  needsInput: Application[];
  readyToApprove: Application[];
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
