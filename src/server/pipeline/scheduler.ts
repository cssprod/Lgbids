import type { AppDeps, Pipeline, Scheduler } from '../contracts.js';
import { nowIso } from '../util/dates.js';
import { runReminders as defaultRunReminders } from './reminders.js';

/**
 * Runs the pipeline every `intervalHours` while automation is switched on.
 *
 * One timer at a time, re-armed after every attempt, with the settings read
 * afresh each time so a change in Settings takes effect without a restart.
 * The timer never keeps the process alive on its own (`unref`).
 */

/** Wait after start-up before an overdue run, so the server is fully up first. */
export const STARTUP_DELAY_MS = 20_000;
/** setTimeout cannot wait longer than this; longer waits are done in steps. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** How often the wall clock is compared with the next run time (a sleeping laptop can delay timers). */
export const WATCHDOG_MS = 5 * 60_000;
/** How often closing reminders are checked, whatever the automation mode (decision D16). */
export const REMINDER_TICK_MS = 15 * 60_000;

export interface SchedulerOptions {
  watchdogMs?: number;
  reminderMs?: number;
  runReminders?: (deps: AppDeps, now: Date) => Promise<unknown>;
}

export function createScheduler(deps: AppDeps, pipeline: Pipeline, opts: SchedulerOptions = {}): Scheduler {
  let started = false;
  let timer: NodeJS.Timeout | null = null;
  let nextAt: Date | null = null;
  let firing = false;
  let reminding = false;
  let watchdog: NodeJS.Timeout | null = null;
  let reminderTick: NodeJS.Timeout | null = null;
  const reminders = opts.runReminders ?? defaultRunReminders;

  /** Timers can oversleep (suspend, clock changes); when the wall clock is past nextAt, run now. */
  function checkWallClock(): void {
    if (!started || firing || !nextAt || pipeline.isRunning()) return;
    if (deps.now().getTime() < nextAt.getTime()) return;
    if (timer) clearTimeout(timer);
    timer = null;
    void fire();
  }

  async function remind(): Promise<void> {
    if (!started || reminding) return;
    reminding = true;
    try {
      await reminders(deps, deps.now());
    } catch {
      // A failed reminder check is retried on the next tick; it never stops the schedule.
    } finally {
      reminding = false;
    }
  }

  const intervalMs = () => deps.settings.getAutomation().intervalHours * 3_600_000;

  /** When the next run is due by the clock: the last finished run plus the interval, or null if there never was one. */
  function dueAt(): Date | null {
    const last = deps.store.listRuns(20).find((r) => r.finishedAt);
    return last?.finishedAt ? new Date(new Date(last.finishedAt).getTime() + intervalMs()) : null;
  }

  function clear(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    nextAt = null;
  }

  function arm(at: Date): void {
    clear();
    nextAt = at;
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, at.getTime() - deps.now().getTime()));
    timer = setTimeout(() => void fire(), delay);
    timer.unref();
  }

  /** Arm from the current settings: soon if a run is overdue, otherwise when it falls due. */
  function armFromSettings(): void {
    clear();
    if (!started) return;
    try {
      if (deps.settings.getAutomation().mode === 'off') return;
      const due = dueAt();
      const now = deps.now().getTime();
      arm(due && due.getTime() > now ? due : new Date(now + STARTUP_DELAY_MS));
    } catch {
      // Settings could not be read; try again later rather than never.
      arm(new Date(deps.now().getTime() + 3_600_000));
    }
  }

  async function fire(): Promise<void> {
    if (firing) return;
    firing = true;
    try {
      await fireOnce();
    } finally {
      firing = false;
    }
  }

  async function fireOnce(): Promise<void> {
    timer = null;
    if (!started) return;
    let interval = 3_600_000;
    try {
      const automation = deps.settings.getAutomation();
      if (automation.mode === 'off') {
        nextAt = null;
        return;
      }
      interval = automation.intervalHours * 3_600_000;
      const now = deps.now().getTime();
      if (pipeline.isRunning()) {
        // A manual run is under way; it counts as this one.
        arm(new Date(now + interval));
        return;
      }
      // A manual run since the timer was set may have made this one early,
      // and long waits are done in steps; either way, wait for the real time.
      const due = dueAt();
      if (due && due.getTime() > now + 1000) {
        arm(due);
        return;
      }
      await pipeline.run('schedule');
    } catch {
      // The run records its own failures; a scheduling hiccup must not stop the timer.
    }
    if (!started || timer) return;
    try {
      const due = dueAt();
      const now = deps.now().getTime();
      arm(due && due.getTime() > now ? due : new Date(now + interval));
    } catch {
      arm(new Date(deps.now().getTime() + interval));
    }
  }

  return {
    start() {
      started = true;
      armFromSettings();
      if (!watchdog) {
        watchdog = setInterval(checkWallClock, opts.watchdogMs ?? WATCHDOG_MS);
        watchdog.unref();
      }
      if (!reminderTick) {
        reminderTick = setInterval(() => void remind(), opts.reminderMs ?? REMINDER_TICK_MS);
        reminderTick.unref();
      }
    },
    stop() {
      started = false;
      clear();
      if (watchdog) clearInterval(watchdog);
      if (reminderTick) clearInterval(reminderTick);
      watchdog = null;
      reminderTick = null;
    },
    reschedule() {
      armFromSettings();
    },
    nextRunAt() {
      return started && nextAt ? nowIso(nextAt) : null;
    },
  };
}
