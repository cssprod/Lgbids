import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shutdownGracefully } from '../src/server/bootstrap.js';
import type { AppDeps, Pipeline, Scheduler } from '../src/server/contracts.js';
import { createScheduler } from '../src/server/pipeline/scheduler.js';

const START = new Date('2026-11-22T10:00:00Z').getTime();

function setup(mode: 'off' | 'prepare' = 'prepare') {
  let clock = START;
  const finished = new Date(START - 30 * 60_000).toISOString();
  const deps = {
    now: () => new Date(clock),
    settings: { getAutomation: () => ({ mode, intervalHours: 6 }) },
    store: { listRuns: () => [{ finishedAt: finished }] },
  } as unknown as AppDeps;
  let running = false;
  const runs: string[] = [];
  let release: () => void = () => undefined;
  const pipeline = {
    isRunning: () => running,
    run: vi.fn(async (trigger: string) => {
      runs.push(trigger);
      running = true;
      await new Promise<void>((resolve) => (release = resolve));
      running = false;
    }),
  } as unknown as Pipeline;
  const reminders = vi.fn(async () => ({ sent: 0, failed: 0 }));
  const scheduler = createScheduler(deps, pipeline, { watchdogMs: 60_000, reminderMs: 120_000, runReminders: reminders });
  return {
    scheduler,
    runs,
    reminders,
    jumpClock: (ms: number) => (clock += ms),
    finishRun: () => release(),
  };
}

let current: Scheduler | null = null;
beforeEach(() => vi.useFakeTimers({ now: START }));
afterEach(() => {
  current?.stop();
  vi.useRealTimers();
});

describe('scheduler watchdog', () => {
  it('fires one run when the wall clock passes nextAt although the timer slept', async () => {
    const t = setup();
    current = t.scheduler;
    t.scheduler.start();
    expect(t.scheduler.nextRunAt()).not.toBeNull();
    t.jumpClock(6 * 3_600_000); // the laptop slept: deps.now() moved, the timer did not
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.runs).toEqual(['schedule']);
    // Still running: more watchdog ticks start nothing else.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(t.runs).toHaveLength(1);
    t.finishRun();
  });

  it('runs the reminder tick even when automation is off', async () => {
    const t = setup('off');
    current = t.scheduler;
    t.scheduler.start();
    expect(t.scheduler.nextRunAt()).toBeNull();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(t.reminders).toHaveBeenCalledTimes(2);
    expect(t.runs).toEqual([]);
    t.scheduler.stop();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(t.reminders).toHaveBeenCalledTimes(2);
  });
});

describe('graceful shutdown', () => {
  it('stops the schedule, waits for the running check, then stops the server', async () => {
    let running = true;
    const order: string[] = [];
    const server = {
      scheduler: { stop: () => order.push('scheduler') } as unknown as Scheduler,
      pipeline: { isRunning: () => running } as unknown as Pipeline,
      stop: async () => {
        order.push('server');
      },
    };
    const done = shutdownGracefully(server, { waitMs: 25_000, pollMs: 100 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual(['scheduler']);
    running = false;
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(order).toEqual(['scheduler', 'server']);
  });

  it('gives up waiting after the limit', async () => {
    const stop = vi.fn(async () => undefined);
    const done = shutdownGracefully({ scheduler: { stop() {} } as unknown as Scheduler, pipeline: { isRunning: () => true } as unknown as Pipeline, stop }, { waitMs: 25_000, pollMs: 250 });
    await vi.advanceTimersByTimeAsync(26_000);
    await done;
    expect(stop).toHaveBeenCalledOnce();
  });
});
