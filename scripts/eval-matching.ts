// Measures the matching rules against the labelled corpus.
//
//   npm run eval                    readable report
//   npm run eval -- --json          the full report as JSON
//   npm run eval -- --check         exit 1 if a pinned row fails or a metric fell below baseline.json
//   npm run eval -- --write-baseline  record the current metrics (refused if any metric fell)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  evaluateCorpus,
  gateFailures,
  metricDrops,
  METRIC_KEYS,
  parseCorpus,
  type Baseline,
  type EvalReport,
} from '../src/server/matching/evaluate.js';

const corpusPath = fileURLToPath(new URL('../tests/fixtures/corpus/notices.jsonl', import.meta.url));
const baselinePath = fileURLToPath(new URL('../tests/fixtures/corpus/baseline.json', import.meta.url));
const args = new Set(process.argv.slice(2));

const report = evaluateCorpus(parseCorpus(readFileSync(corpusPath, 'utf8')));
const baseline: Baseline | null = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline) : null;
const failures = gateFailures(report, baseline);

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function print(r: EvalReport): void {
  const lines: string[] = [];
  lines.push(`Corpus: ${r.rows} rows (${r.pinnedRows} pinned, ${r.todoRows} known failures marked todo).`);
  lines.push('');
  lines.push(`Relevance  precision ${pct(r.relevance.precision)}  recall ${pct(r.relevance.recall)}  (tp ${r.relevance.tp}, fp ${r.relevance.fp}, fn ${r.relevance.fn}, tn ${r.relevance.tn})`);
  lines.push(`Suitable   precision ${pct(r.suitable.precision)}  recall ${pct(r.suitable.recall)}  (tp ${r.suitable.tp}, fp ${r.suitable.fp}, fn ${r.suitable.fn}, tn ${r.suitable.tn})`);
  lines.push(`Area       accuracy ${pct(r.area.value)} (${r.area.correct}/${r.area.total})`);
  lines.push(`Type       accuracy ${pct(r.type.value)} (${r.type.correct}/${r.type.total})`);
  lines.push(`Decision   accuracy ${pct(r.decision.value)} (${r.decision.correct}/${r.decision.total})`);
  lines.push('');
  lines.push('Decision confusion (rows = expected, columns = actual):');
  lines.push(`  ${'expected'.padEnd(12)}${['suitable', 'review', 'unsuitable'].map((d) => d.padStart(12)).join('')}`);
  for (const [expected, row] of Object.entries(r.confusion)) {
    lines.push(`  ${expected.padEnd(12)}${Object.values(row).map((n) => String(n).padStart(12)).join('')}`);
  }
  if (baseline) {
    lines.push('');
    lines.push('Against baseline.json:');
    for (const key of METRIC_KEYS) {
      const was = baseline.metrics[key];
      const now = r.metrics[key];
      const sign = now > was ? '+' : now < was ? '-' : '=';
      lines.push(`  ${sign} ${key.padEnd(20)} ${now.toFixed(4)} (baseline ${was.toFixed(4)})`);
    }
  }
  if (r.mismatches.length) {
    lines.push('');
    lines.push(`Mismatches (${r.mismatches.length}):`);
    for (const m of r.mismatches) {
      const tag = m.pinned ? 'PINNED' : m.todo ? `todo ${m.todo}` : 'unpinned';
      lines.push(`  [${tag}] ${m.id} "${m.title}"`);
      for (const f of m.wrong) lines.push(`      ${f}: expected ${String(m.expected[f])}, got ${String(m.actual[f])}`);
      lines.push(`      relevance ${m.actual.relevance}, score ${m.actual.score}; terms: ${m.matchedTerms.join(', ') || '(none)'}`);
      const rule = 'rule' in m.areaResult ? ` [${String((m.areaResult as { rule?: unknown }).rule)}]` : '';
      lines.push(`      area${rule}: ${m.areaResult.note}`);
    }
  }
  if (r.todoFixed.length) {
    lines.push('');
    lines.push('Todo rows that now pass (remove "todo" and set "pinned"):');
    for (const t of r.todoFixed) lines.push(`  ${t.id} (${t.todo}) "${t.title}"`);
  }
  lines.push('');
  lines.push(failures.length ? `Gate: FAILED\n${failures.map((f) => `  ${f}`).join('\n')}` : 'Gate: passed.');
  console.log(lines.join('\n'));
}

if (args.has('--write-baseline')) {
  const drops = baseline ? metricDrops(report.metrics, baseline) : [];
  if (drops.length || report.pinnedFailures.length) {
    console.error('Refusing to write a baseline: a lower baseline is never committed.');
    for (const f of gateFailures(report, baseline)) console.error(`  ${f}`);
    process.exit(1);
  }
  const next: Baseline = { rows: report.rows, metrics: report.metrics };
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Baseline written to ${baselinePath}.`);
} else if (args.has('--json')) {
  console.log(JSON.stringify({ ...report, gate: { passed: failures.length === 0, failures } }, null, 2));
} else {
  print(report);
}

if (args.has('--check') && failures.length) process.exit(1);
