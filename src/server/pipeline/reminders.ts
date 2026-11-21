import type { AppDeps } from '../contracts.js';

export interface ReminderOutcome {
  /** Reminders that went out on at least one channel. */
  sent: number;
  /** Reminders due but not delivered on any channel (retried next tick). */
  failed: number;
}

/**
 * Send the 72 h / 24 h closing reminders that are due (UX-7). Never throws.
 * Stub from the v2 foundation: sends nothing yet.
 */
export async function runReminders(_deps: AppDeps, _now: Date): Promise<ReminderOutcome> {
  return { sent: 0, failed: 0 };
}
