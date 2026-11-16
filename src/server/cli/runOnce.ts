import { createDeps } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { createPipeline } from '../pipeline/run.js';

/** `npm run run-once`: one complete run (as the schedule would do it), then exit. */
async function main(): Promise<void> {
  const deps = createDeps(loadConfig(process.env));
  const pipeline = createPipeline(deps);
  console.log(`Running once (mode: ${deps.settings.getAutomation().mode})…`);
  const run = await pipeline.run('cli');
  const stats = run.stats;
  console.log(`\nRun ${run.id} finished: ${run.status}${run.error ? ` — ${run.error}` : ''}`);
  if (stats) {
    for (const s of stats.sources) {
      console.log(`  ${s.name.padEnd(44)} ${s.status.padEnd(8)} found ${String(s.found).padStart(4)}, new ${String(s.added).padStart(3)}  ${s.message}`);
    }
    console.log(
      `\nFound ${stats.found}, new ${stats.added}, analysed ${stats.analysed}, suitable ${stats.suitable}, drafted ${stats.drafted}, sent ${stats.sent}, expired ${stats.expired}.`,
    );
  }
  deps.store.close();
  process.exitCode = run.status === 'error' ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
