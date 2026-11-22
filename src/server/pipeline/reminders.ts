import type { Application, Opportunity } from '../../shared/schemas.js';
import type { AppDeps } from '../contracts.js';
import { closingDeadline, formatLocal, nowIso } from '../util/dates.js';
import { deliverAlert } from './notify.js';

export interface ReminderOutcome {
  /** Reminders that went out on at least one channel. */
  sent: number;
  /** Reminders due but not delivered on any channel (retried next tick). */
  failed: number;
}

const HOUR_MS = 3_600_000;
/** Applications that still need sending (decision D17); submitted, won, lost and withdrawn get no reminder. */
const UNSENT: Application['status'][] = ['needs_input', 'ready', 'failed'];

/**
 * The reminder threshold due now, or null. Each threshold opens at
 * deadline − h and closes at the deadline; when several are open (a bid
 * pursued late), only the nearest one is sent, so the user gets one message.
 */
export function dueThreshold(hours: number[], deadline: Date, now: Date): number | null {
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return null;
  const open = hours.filter((h) => left <= h * HOUR_MS);
  return open.length ? Math.min(...open) : null;
}

/** Where to upload a portal bid, named as the user knows it. */
function portalName(opp: Opportunity): string {
  const where = `${opp.submissionUrl} ${opp.url} ${opp.sourceName}`.toLowerCase();
  if (where.includes('bonfire')) return 'Bonfire';
  if (where.includes('bcbid') || where.includes('bc bid')) return 'BC Bid';
  if (where.includes('bidsandtenders') || where.includes('bids&tenders')) return 'bids&tenders';
  return 'the bid site';
}

function lowerFirst(text: string): string {
  return text ? text[0]!.toLowerCase() + text.slice(1) : text;
}

/** The last sentence of a reminder: what is left to do. */
export function nextStep(opp: Opportunity, app: Application | undefined): string {
  if (!app) return 'Nothing is prepared yet. Open Lgbids to start the submission.';
  if (app.status === 'failed') return 'Sending failed. Open Lgbids to try again.';
  if (app.status === 'needs_input') {
    const items = app.missing.map((m) => lowerFirst(m.trim().replace(/[.!?]+$/, ''))).filter(Boolean);
    return items.length ? `Still needs: ${items.join(', ')}.` : 'It still needs your input.';
  }
  if (app.channel === 'portal') return `Upload it on ${portalName(opp)}, then mark it submitted.`;
  if (app.channel === 'manual') return 'Deliver it as the notice asks, then mark it submitted.';
  return 'Ready to send.';
}

export function reminderText(h: number, opp: Opportunity, app: Application | undefined, zone: string): string {
  const buyer = opp.organization ? ` — ${opp.organization}` : '';
  const when = formatLocal(opp.closesAt, opp.closesAtPrecision, zone);
  return `Closes in ${h} hours: ${opp.title}${buyer}, ${when}. ${nextStep(opp, app)}`;
}

/**
 * Send the 72 h / 24 h closing reminders that are due (UX-7). Never throws.
 * They run whatever the automation mode (D16); the Notifications switch
 * decides the e-mail copy, the phone alert follows the phone set-up.
 */
export async function runReminders(deps: AppDeps, now: Date): Promise<ReminderOutcome> {
  const outcome: ReminderOutcome = { sent: 0, failed: 0 };
  const { store, settings } = deps;
  try {
    const automation = settings.getAutomation();
    const hours = automation.reminderHours;
    if (hours.length === 0) return outcome;
    const zone = deps.config.timeZone;

    // Pursued bids plus unsent applications (D17), one entry per bid.
    const candidates = new Map<number, { opp: Opportunity; app: Application | undefined }>();
    for (let offset = 0; ; offset += 500) {
      const page = store.listOpportunities({ view: 'suitable', limit: 500, offset }, now);
      for (const o of page.items) if (o.userDecision === 'pursue') candidates.set(o.id, { opp: o, app: undefined });
      if (page.items.length < 500) break;
    }
    for (const app of store.listApplications({ status: UNSENT })) {
      const opp = candidates.get(app.opportunityId)?.opp ?? store.getOpportunity(app.opportunityId);
      if (opp) candidates.set(app.opportunityId, { opp, app });
    }

    for (const entry of candidates.values()) {
      const { opp } = entry;
      if (opp.status !== 'open' || opp.alertsMuted || opp.duplicateOf !== null || !opp.closesAt) continue;
      // A pursued bid whose submission already went out (or was given up) gets none.
      const app = entry.app ?? store.getApplicationByOpportunity(opp.id);
      if (app && !UNSENT.includes(app.status)) continue;
      const deadline = closingDeadline(opp.closesAt, opp.closesAtPrecision, zone);
      const h = dueThreshold(hours, deadline, now);
      if (h === null || store.reminderSent(opp.id, h, opp.closesAt)) continue;

      const text = reminderText(h, opp, app, zone);
      const { channels } = await deliverAlert(
        deps,
        {
          title: `Closes in ${h} hours: ${opp.title}`,
          lines: [text],
          url: opp.url,
          path: app ? `/applications/${app.id}` : `/opportunities/${opp.id}`,
          email: automation.notifyReminders,
          opportunityId: opp.id,
          applicationId: app?.id ?? null,
          what: 'closing reminder',
        },
        now,
      );
      if (channels.length === 0) {
        // Nothing went out (or nothing is set up): tried again on the next tick.
        outcome.failed += 1;
        continue;
      }
      // Keyed on the closing instant, so a moved date re-arms the reminders.
      store.recordReminder({ opportunityId: opp.id, thresholdHours: h, closesAt: opp.closesAt, sentAt: nowIso(now), channels });
      if (app) store.updateApplication(app.id, { remindedAt: nowIso(now) }, now);
      store.addEvent({ level: 'info', kind: 'reminder_sent', message: `Sent a reminder: ${text}`, opportunityId: opp.id, applicationId: app?.id ?? null, runId: null }, now);
      outcome.sent += 1;
    }
  } catch (error) {
    try {
      const message = error instanceof Error ? error.message : String(error);
      store.addEvent({ level: 'warn', kind: 'notify', message: `The closing reminders could not be checked: ${message}`, opportunityId: null, applicationId: null, runId: null }, now);
    } catch {
      // Nothing more can be done; the next tick tries again.
    }
  }
  return outcome;
}
