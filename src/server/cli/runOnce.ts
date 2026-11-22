import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeps } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import type { AppDeps, Pipeline } from '../contracts.js';
import { createPipeline } from '../pipeline/run.js';

/**
 * `npm run run-once`: one complete run (as the schedule would do it). Returns the
 * exit code: 1 when the run failed or any source errored or was blocked.
 */
export async function runOnce(deps: AppDeps, pipeline: Pipeline, out: (line: string) => void = console.log): Promise<number> {
  out(`Running once (mode: ${deps.settings.getAutomation().mode})…`);
  const run = await pipeline.run('cli');
  const stats = run.stats;
  out(`\nRun ${run.id} finished: ${run.status}${run.error ? ` — ${run.error}` : ''}`);
  let failed = false;
  if (stats) {
    for (const s of stats.sources) {
      if (s.status === 'error' || s.status === 'blocked') failed = true;
      out(`  ${s.name.padEnd(44)} ${s.status.padEnd(8)} found ${String(s.found).padStart(4)}, new ${String(s.added).padStart(3)}  ${s.message}`);
    }
    out(`\nFound ${stats.found}, new ${stats.added}, analysed ${stats.analysed}, suitable ${stats.suitable}, drafted ${stats.drafted}, sent ${stats.sent}, expired ${stats.expired}.`);
  }
  return run.status === 'error' || failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const deps = createDeps(loadConfig(process.env));
    try {
      process.exitCode = await runOnce(deps, createPipeline(deps));
    } finally {
      deps.store.close();
    }
  })().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
