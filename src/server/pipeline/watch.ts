import type { AppDeps } from '../contracts.js';

export interface ChangeAlertOutcome {
  /** Changes alerted (push or e-mail went through). */
  sent: number;
  /** Changes marked notified without an alert (silent kinds, muted or unwatched bids). */
  skipped: number;
}

/**
 * Alert on unnotified changes to watched bids (MAT-10). Never throws.
 * Stub from the v2 foundation: alerts nothing yet.
 */
export async function notifyChanges(_deps: AppDeps, _now: Date): Promise<ChangeAlertOutcome> {
  return { sent: 0, skipped: 0 };
}
