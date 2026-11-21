import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateCorpus,
  gateFailures,
  metricDrops,
  parseCorpus,
  precisionRecall,
  summarise,
  type Baseline,
  type RowResult,
} from '../src/server/matching/evaluate.js';

const corpus = parseCorpus(readFileSync(new URL('./fixtures/corpus/notices.jsonl', import.meta.url), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('./fixtures/corpus/baseline.json', import.meta.url), 'utf8')) as Baseline;

describe('matching corpus gate', () => {
  const report = evaluateCorpus(corpus);

  it('has enough labelled rows', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(150);
    // A known failure names the task that fixes it and is not pinned at the same time.
    for (const row of corpus) if (row.todo) expect(row.pinned, row.id).toBe(false);
  });

  it('gets every pinned row right', () => {
    const failures = report.pinnedFailures.map((r) => `${r.id} "${r.title}": ${r.wrong.join(', ')}`);
    expect(failures).toEqual([]);
  });

  it('does not fall below the recorded baseline', () => {
    expect(metricDrops(report.metrics, baseline)).toEqual([]);
  });
});

describe('metric maths', () => {
  it('counts precision and recall', () => {
    const pr = precisionRecall([
      { expected: true, actual: true },
      { expected: true, actual: true },
      { expected: true, actual: false },
      { expected: false, actual: true },
      { expected: false, actual: false },
    ]);
    expect(pr).toMatchObject({ tp: 2, fp: 1, fn: 1, tn: 1, precision: 0.6667, recall: 0.6667 });
  });

  it('treats an empty denominator as perfect', () => {
    expect(precisionRecall([{ expected: false, actual: false }])).toMatchObject({ precision: 1, recall: 1 });
    expect(precisionRecall([])).toMatchObject({ precision: 1, recall: 1 });
  });

  const row = (id: string, pinned: boolean, expected: RowResult['expected'], actual: Partial<RowResult['actual']>, todo?: string): RowResult => {
    const full = { relevant: true, relevance: 80, decision: 'suitable' as const, area: 'yes' as const, type: 'RFQ' as const, score: 90, ...actual };
    return {
      id,
      title: id,
      origin: 'invented',
      pinned,
      ...(todo ? { todo } : {}),
      expected,
      actual: full,
      wrong: (['relevant', 'decision', 'area', 'type'] as const).filter((f) => expected[f] !== full[f]),
      matchedTerms: [],
      areaResult: { area: full.area, match: '', note: '' },
    };
  };
  const good = { relevant: true, decision: 'suitable', area: 'yes', type: 'RFQ' } as const;
  const tiny = [
    row('a', true, good, {}),
    row('b', true, { ...good, decision: 'review' }, {}),
    row('c', false, { relevant: false, decision: 'unsuitable', area: 'no', type: 'OTHER' }, { relevant: false, decision: 'unsuitable', area: 'yes', type: 'OTHER' }),
    row('d', false, good, { decision: 'unsuitable' }, 'MAT-4'),
    row('e', false, { ...good, decision: 'unsuitable' }, { decision: 'unsuitable' }, 'MAT-3'),
  ];

  it('summarises a tiny corpus', () => {
    const r = summarise(tiny);
    expect(r.rows).toBe(5);
    expect(r.pinnedRows).toBe(2);
    expect(r.todoRows).toBe(2);
    // Suitable: a is a hit, b is claimed but expected review, d is missed.
    expect(r.suitable).toMatchObject({ tp: 1, fp: 1, fn: 1, tn: 2, precision: 0.5, recall: 0.5 });
    expect(r.relevance).toMatchObject({ tp: 4, fp: 0, fn: 0, tn: 1 });
    expect(r.area).toEqual({ correct: 4, total: 5, value: 0.8 });
    expect(r.decision).toEqual({ correct: 3, total: 5, value: 0.6 });
    expect(r.confusion.review.suitable).toBe(1);
    expect(r.confusion.suitable.unsuitable).toBe(1);
    expect(r.pinnedFailures.map((m) => m.id)).toEqual(['b']);
    expect(r.mismatches.map((m) => m.id)).toEqual(['b', 'c', 'd']);
    expect(r.todoFixed.map((m) => m.id)).toEqual(['e']);
  });

  it('fails the gate on a pinned failure or a dropped metric, not on todo rows', () => {
    const r = summarise(tiny);
    const higher: Baseline = { metrics: { ...r.metrics, areaAccuracy: 0.9 } };
    expect(gateFailures(r, { metrics: r.metrics })).toHaveLength(1);
    expect(gateFailures(r, higher)).toHaveLength(2);
    expect(metricDrops(r.metrics, higher)[0]).toContain('areaAccuracy');
    const withoutPinned = summarise(tiny.filter((m) => m.id !== 'b'));
    expect(gateFailures(withoutPinned, null)).toEqual([]);
  });

  it('rejects malformed and duplicate rows', () => {
    const line = JSON.stringify({ id: 'x', origin: 'invented', title: 'Lawn Mowing', expected: good });
    expect(parseCorpus(`${line}\n\n// a comment\n`)).toHaveLength(1);
    expect(() => parseCorpus(`${line}\n${line}`)).toThrow(/repeats/);
    expect(() => parseCorpus('{"id":"y"}')).toThrow(/line 1/);
    expect(() => parseCorpus('not json')).toThrow(/not valid JSON/);
  });
});
