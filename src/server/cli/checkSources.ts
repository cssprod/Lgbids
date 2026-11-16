import { createDeps } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { createPipeline } from '../pipeline/run.js';

/**
 * `npm run check-sources`: read every enabled source once, save nothing, and
 * print what came back. Exits with 1 when any source failed or was blocked.
 */

function cell(value: string, width: number): string {
  const text = value.length > width ? `${value.slice(0, width - 1)}…` : value;
  return text.padEnd(width);
}

async function main(): Promise<void> {
  const deps = createDeps(loadConfig(process.env));
  const pipeline = createPipeline(deps);
  const sources = deps.store.listSources().filter((s) => s.enabled);
  if (sources.length === 0) {
    console.log('No sources are switched on.');
    deps.store.close();
    return;
  }

  let failed = 0;
  const rows: string[] = [];
  const samples: string[] = [];
  for (const source of sources) {
    process.stdout.write(`Checking ${source.name}…\n`);
    const result = await pipeline.testSource(source);
    if (result.status === 'error' || result.status === 'blocked') failed += 1;
    rows.push([cell(source.name, 44), cell(result.status, 8), String(result.count).padStart(6), `${result.ms} ms`.padStart(10), `  ${result.message}`].join(' '));
    if (result.sample.length > 0) {
      samples.push(`${source.name}:`, ...result.sample.slice(0, 3).map((s) => `  - ${s.title}${s.closesAt ? ` (closes ${s.closesAt})` : ''}`));
    }
  }

  console.log('');
  console.log([cell('Source', 44), cell('Status', 8), 'Count'.padStart(6), 'Time'.padStart(10), '  Message'].join(' '));
  console.log('-'.repeat(100));
  for (const row of rows) console.log(row);
  if (samples.length > 0) {
    console.log('\nFirst notices read:');
    for (const line of samples) console.log(line);
  }
  console.log(failed > 0 ? `\n${failed} of ${sources.length} sources failed or were blocked.` : `\nAll ${sources.length} sources answered.`);
  deps.store.close();
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
