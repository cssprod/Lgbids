import type { AppDeps, Pipeline, Scheduler } from '../contracts.js';
import { nowIso } from '../util/dates.js';

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

export function createScheduler(deps: AppDeps, pipeline: Pipeline): Scheduler {
  let started = false;
  let timer: NodeJS.Timeout | null = null;
  let nextAt: Date | null = null;

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
    },
    stop() {
      started = false;
      clear();
    },
    reschedule() {
      armFromSettings();
    },
    nextRunAt() {
      return started && nextAt ? nowIso(nextAt) : null;
    },
  };
}
