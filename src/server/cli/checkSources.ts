import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeps } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import type { AppDeps, Pipeline } from '../contracts.js';
import { createPipeline } from '../pipeline/run.js';

/**
 * `npm run check-sources`: read every enabled source once, save nothing, and
 * print what came back. Exits with 1 when any source failed or was blocked.
 */

function cell(value: string, width: number): string {
  const text = value.length > width ? `${value.slice(0, width - 1)}…` : value;
  return text.padEnd(width);
}

/** Read every enabled source once and print the result; returns the exit code. */
export async function checkSources(deps: AppDeps, pipeline: Pipeline, out: (line: string) => void = console.log): Promise<number> {
  const sources = deps.store.listSources().filter((s) => s.enabled);
  if (sources.length === 0) {
    out('No sources are switched on.');
    return 0;
  }

  let failed = 0;
  const rows: string[] = [];
  const samples: string[] = [];
  for (const source of sources) {
    out(`Checking ${source.name}…`);
    const result = await pipeline.testSource(source);
    if (result.status === 'error' || result.status === 'blocked') failed += 1;
    rows.push([cell(source.name, 44), cell(result.status, 8), String(result.count).padStart(6), `${result.ms} ms`.padStart(10), `  ${result.message}`].join(' '));
    if (result.sample.length > 0) {
      samples.push(`${source.name}:`, ...result.sample.slice(0, 3).map((s) => `  - ${s.title}${s.closesAt ? ` (closes ${s.closesAt})` : ''}`));
    }
  }

  out('');
  out([cell('Source', 44), cell('Status', 8), 'Count'.padStart(6), 'Time'.padStart(10), '  Message'].join(' '));
  out('-'.repeat(100));
  for (const row of rows) out(row);
  if (samples.length > 0) {
    out('\nFirst notices read:');
    for (const line of samples) out(line);
  }
  out(failed > 0 ? `\n${failed} of ${sources.length} sources failed or were blocked.` : `\nAll ${sources.length} sources answered.`);
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const deps = createDeps(loadConfig(process.env));
    try {
      process.exitCode = await checkSources(deps, createPipeline(deps));
    } finally {
      deps.store.close();
    }
  })().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
