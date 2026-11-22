import type { Application, NoticeChange, Opportunity } from '../../shared/schemas.js';
import type { AppDeps, Store } from '../contracts.js';
import { deliverAlert } from './notify.js';

export interface ChangeAlertOutcome {
  /** Changes alerted (push or e-mail went through). */
  sent: number;
  /** Changes marked notified without an alert (silent kinds, muted or unwatched bids). */
  skipped: number;
}

/** Applications that make a bid "watched" (decision D12). */
const WATCHED_STATUSES: Application['status'][] = ['needs_input', 'ready', 'submitted'];

/** A same-day date upgraded to a time is recorded but never alerted. */
export function isSilentChange(change: Pick<NoticeChange, 'kind'>): boolean {
  return change.kind === 'closing_refined';
}

/** Pursued, or with an application in needs input, ready or submitted (D12). */
export function isWatched(opp: Pick<Opportunity, 'userDecision' | 'application'>): boolean {
  return opp.userDecision === 'pursue' || (!!opp.application && WATCHED_STATUSES.includes(opp.application.status));
}

/** Watched, unmuted, canonical: the bids whose changes are worth a message. */
export function alertsWanted(opp: Opportunity | undefined): opp is Opportunity {
  return !!opp && opp.duplicateOf === null && !opp.alertsMuted && isWatched(opp);
}

/** Non-silent changes on watched, unmuted bids from one run, for the summary e-mail. */
export function watchedChangesOfRun(store: Store, runId: number): { change: NoticeChange; opp: Opportunity }[] {
  const out: { change: NoticeChange; opp: Opportunity }[] = [];
  const cache = new Map<number, Opportunity | undefined>();
  // Changes stay unnotified until the alerts below run, so this run's rows are among them.
  for (const change of store.unnotifiedChanges()) {
    if (change.runId !== runId || isSilentChange(change)) continue;
    if (!cache.has(change.opportunityId)) cache.set(change.opportunityId, store.getOpportunity(change.opportunityId));
    const opp = cache.get(change.opportunityId);
    if (alertsWanted(opp)) out.push({ change, opp });
  }
  return out;
}

/**
 * Alert on unnotified changes to watched bids (MAT-10). Never throws.
 * Each change is told once: a push when phone alerts are set up, plus an
 * e-mail when "Changes to bids you pursue" is on. Silent kinds, muted and
 * unwatched bids are marked as told without a message, so they never pile up.
 */
export async function notifyChanges(deps: AppDeps, now: Date): Promise<ChangeAlertOutcome> {
  const outcome: ChangeAlertOutcome = { sent: 0, skipped: 0 };
  const { store, settings } = deps;
  try {
    const automation = settings.getAutomation();
    for (const change of store.unnotifiedChanges()) {
      const opp = store.getOpportunity(change.opportunityId);
      if (isSilentChange(change) || !alertsWanted(opp)) {
        store.markChangesNotified([change.id], now);
        outcome.skipped += 1;
        continue;
      }
      const buyer = opp.organization ? ` — ${opp.organization}` : '';
      const { channels, tried } = await deliverAlert(
        deps,
        {
          title: `Changed: ${opp.title}`,
          lines: [`${opp.title}${buyer}: ${change.summary}`],
          url: opp.url,
          path: opp.application ? `/applications/${opp.application.id}` : `/opportunities/${opp.id}`,
          email: automation.notifyChanges,
          opportunityId: opp.id,
          applicationId: opp.application?.id ?? null,
          what: 'change alert',
        },
        now,
      );
      if (channels.length === 0 && tried > 0) {
        // Every channel failed (logged as a warning): tried again after the next check.
        continue;
      }
      // With nothing set up there is no one to tell; the change stays on the bid page.
      store.markChangesNotified([change.id], now);
      if (channels.length) {
        store.addEvent({ level: 'info', kind: 'change_alert', message: `Sent an alert: ${opp.title}: ${change.summary}`, opportunityId: opp.id, applicationId: opp.application?.id ?? null, runId: change.runId }, now);
        outcome.sent += 1;
      } else {
        outcome.skipped += 1;
      }
    }
  } catch (error) {
    try {
      const message = error instanceof Error ? error.message : String(error);
      store.addEvent({ level: 'warn', kind: 'notify', message: `The change alerts could not be sent: ${message}`, opportunityId: null, applicationId: null, runId: null }, now);
    } catch {
      // Nothing more can be done; the run is unaffected.
    }
  }
  return outcome;
}
