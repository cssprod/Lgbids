import { z } from 'zod';
import {
  automationSchema,
  NOTICE_TYPES,
  profileSchema,
  SUBMISSION_METHODS,
  type Decision,
  type NoticeType,
} from '../../shared/schemas.js';
import { analyse, type AnalyseContext, type AnalyseInput } from './analyse.js';
import { assessArea, defaultRegion, type AreaResult } from './geo.js';
import { BORDERLINE_AT } from './relevance.js';

/**
 * Measures the matching rules against a labelled corpus of notices, so every
 * rule change can be judged by numbers instead of by a handful of examples.
 *
 * Pure: the caller reads the corpus file and prints the report.
 */

const DECISIONS = ['suitable', 'review', 'unsuitable'] as const;
const AREAS = ['yes', 'no', 'unknown'] as const;
type Area = (typeof AREAS)[number];

/**
 * One labelled notice: the AnalyseInput fields (missing ones default to an
 * open, undated notice from an unnamed source), the expected verdicts, and
 * where the row came from. A `todo` row is a known failure that the named
 * task fixes; that task then removes `todo` and sets `pinned`.
 */
export const corpusRowSchema = z.object({
  id: z.string().min(1),
  origin: z.enum(['invented', 'test', 'beta']),
  pinned: z.boolean().default(false),
  todo: z.string().optional(),
  note: z.string().optional(),
  title: z.string(),
  organization: z.string().default(''),
  description: z.string().default(''),
  location: z.string().default(''),
  categories: z.array(z.string()).default([]),
  noticeTypeHint: z.string().default(''),
  closesAt: z.string().nullable().default(null),
  closesAtPrecision: z.enum(['datetime', 'date']).nullable().default(null),
  status: z.enum(['open', 'closed', 'cancelled', 'awarded']).default('open'),
  url: z.string().default(''),
  documentText: z.string().default(''),
  localSource: z.boolean().default(false),
  bcSource: z.boolean().default(false),
  sourceSubmission: z.enum(SUBMISSION_METHODS).default('unknown'),
  expected: z.object({
    relevant: z.boolean(),
    decision: z.enum(DECISIONS),
    area: z.enum(AREAS),
    type: z.enum(NOTICE_TYPES),
  }),
});
export type CorpusRow = z.infer<typeof corpusRowSchema>;
export type CorpusExpected = CorpusRow['expected'];

/** Parses JSONL text; blank lines and lines starting with `//` are skipped. */
export function parseCorpus(text: string): CorpusRow[] {
  const rows: CorpusRow[] = [];
  const ids = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) return;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error(`Corpus line ${i + 1} is not valid JSON.`);
    }
    const parsed = corpusRowSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Corpus line ${i + 1} is not a valid row: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.`);
    if (ids.has(parsed.data.id)) throw new Error(`Corpus line ${i + 1} repeats the id "${parsed.data.id}".`);
    ids.add(parsed.data.id);
    rows.push(parsed.data);
  });
  return rows;
}

/** The clock every eval run uses, so dated rows give the same answer on any day. */
export const EVAL_NOW = '2026-06-15T20:00:00.000Z';
export const EVAL_ZONE = 'America/Vancouver';

/**
 * A fixed, complete profile for a full-service landscaper. Snow, hardscape,
 * supply-only and design work are left out on purpose, so the corpus also
 * checks the "not a service you offer" rule.
 */
export function evalContext(): AnalyseContext {
  return {
    profile: profileSchema.parse({
      legalName: 'Example Landscaping Ltd.',
      worksafeNumber: '123456',
      businessLicence: 'Inter-municipal 0001',
      insuranceLiability: 5_000_000,
      references: [{ client: 'A' }, { client: 'B' }, { client: 'C' }],
      services: { tree: true, irrigation: true, restoration: true },
    }),
    automation: automationSchema.parse({}),
    region: defaultRegion(),
    now: new Date(EVAL_NOW),
    zone: EVAL_ZONE,
  };
}

export interface RowActual {
  relevant: boolean;
  relevance: number;
  decision: Decision;
  area: Area;
  type: NoticeType;
  score: number;
}

export type Field = 'relevant' | 'decision' | 'area' | 'type';
const FIELDS: Field[] = ['relevant', 'decision', 'area', 'type'];

export interface RowResult {
  id: string;
  title: string;
  origin: CorpusRow['origin'];
  pinned: boolean;
  todo?: string;
  expected: CorpusExpected;
  actual: RowActual;
  /** The fields that differ from the label; empty when the row passes. */
  wrong: Field[];
  matchedTerms: string[];
  /** The full area result (it carries the rule id once MAT-2 adds one). */
  areaResult: AreaResult;
}

export interface Ratio {
  correct: number;
  total: number;
  value: number;
}

export interface PrecisionRecall {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
}

/** The numbers the gate compares with baseline.json (all 0–1, higher is better). */
export interface EvalMetrics {
  relevancePrecision: number;
  relevanceRecall: number;
  suitablePrecision: number;
  suitableRecall: number;
  areaAccuracy: number;
  typeAccuracy: number;
  decisionAccuracy: number;
}
export const METRIC_KEYS: (keyof EvalMetrics)[] = [
  'relevancePrecision',
  'relevanceRecall',
  'suitablePrecision',
  'suitableRecall',
  'areaAccuracy',
  'typeAccuracy',
  'decisionAccuracy',
];

export interface EvalReport {
  rows: number;
  pinnedRows: number;
  todoRows: number;
  relevance: PrecisionRecall;
  suitable: PrecisionRecall;
  area: Ratio;
  type: Ratio;
  decision: Ratio;
  /** confusion[expected][actual] = count. */
  confusion: Record<Decision, Record<Decision, number>>;
  metrics: EvalMetrics;
  /** Every row that differs from its label, pinned ones first. */
  mismatches: RowResult[];
  /** Pinned rows that fail: any of these fails the gate. */
  pinnedFailures: RowResult[];
  /** Todo rows that now pass: their task can pin them. */
  todoFixed: RowResult[];
}

/** Rounded so a baseline written to JSON compares equal to the run that wrote it. */
export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** An empty denominator counts as perfect: nothing was claimed, so nothing was wrong. */
function safeRatio(num: number, den: number): number {
  return den === 0 ? 1 : num / den;
}

export function precisionRecall(pairs: { expected: boolean; actual: boolean }[]): PrecisionRecall {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const { expected, actual } of pairs) {
    if (expected && actual) tp += 1;
    else if (!expected && actual) fp += 1;
    else if (expected && !actual) fn += 1;
    else tn += 1;
  }
  return { tp, fp, fn, tn, precision: round4(safeRatio(tp, tp + fp)), recall: round4(safeRatio(tp, tp + fn)) };
}

function ratio(flags: boolean[]): Ratio {
  const correct = flags.filter(Boolean).length;
  return { correct, total: flags.length, value: round4(safeRatio(correct, flags.length)) };
}

function inputOf(row: CorpusRow): AnalyseInput {
  return {
    title: row.title,
    organization: row.organization,
    description: row.description,
    location: row.location,
    categories: row.categories,
    noticeTypeHint: row.noticeTypeHint,
    closesAt: row.closesAt,
    closesAtPrecision: row.closesAtPrecision,
    status: row.status,
    url: row.url,
    documentText: row.documentText,
    localSource: row.localSource,
    bcSource: row.bcSource,
    sourceSubmission: row.sourceSubmission,
  };
}

export function evaluateRow(row: CorpusRow, ctx: AnalyseContext): RowResult {
  const input = inputOf(row);
  const result = analyse(input, ctx);
  const areaResult = assessArea(
    {
      title: input.title,
      organization: input.organization,
      location: input.location,
      description: input.description,
      localSource: input.localSource,
      bcSource: input.bcSource,
    },
    ctx.region,
  );
  const actual: RowActual = {
    // Below the borderline the notice is ruled out as "not landscaping work".
    relevant: result.analysis.relevance >= BORDERLINE_AT,
    relevance: result.analysis.relevance,
    decision: result.decision,
    area: result.analysis.area,
    type: result.noticeType,
    score: result.score,
  };
  return {
    id: row.id,
    title: row.title,
    origin: row.origin,
    pinned: row.pinned,
    ...(row.todo ? { todo: row.todo } : {}),
    expected: row.expected,
    actual,
    wrong: FIELDS.filter((f) => row.expected[f] !== actual[f]),
    matchedTerms: result.analysis.matchedTerms,
    areaResult,
  };
}

export function summarise(results: RowResult[]): EvalReport {
  const relevance = precisionRecall(results.map((r) => ({ expected: r.expected.relevant, actual: r.actual.relevant })));
  const suitable = precisionRecall(
    results.map((r) => ({ expected: r.expected.decision === 'suitable', actual: r.actual.decision === 'suitable' })),
  );
  const area = ratio(results.map((r) => r.expected.area === r.actual.area));
  const type = ratio(results.map((r) => r.expected.type === r.actual.type));
  const decision = ratio(results.map((r) => r.expected.decision === r.actual.decision));
  const confusion = Object.fromEntries(
    DECISIONS.map((e) => [e, Object.fromEntries(DECISIONS.map((a) => [a, 0]))]),
  ) as EvalReport['confusion'];
  for (const r of results) confusion[r.expected.decision][r.actual.decision] += 1;
  const mismatches = results.filter((r) => r.wrong.length > 0).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return {
    rows: results.length,
    pinnedRows: results.filter((r) => r.pinned).length,
    todoRows: results.filter((r) => r.todo).length,
    relevance,
    suitable,
    area,
    type,
    decision,
    confusion,
    metrics: {
      relevancePrecision: relevance.precision,
      relevanceRecall: relevance.recall,
      suitablePrecision: suitable.precision,
      suitableRecall: suitable.recall,
      areaAccuracy: area.value,
      typeAccuracy: type.value,
      decisionAccuracy: decision.value,
    },
    mismatches,
    pinnedFailures: mismatches.filter((r) => r.pinned),
    todoFixed: results.filter((r) => r.todo && r.wrong.length === 0),
  };
}

export function evaluateCorpus(rows: CorpusRow[], ctx: AnalyseContext = evalContext()): EvalReport {
  return summarise(rows.map((row) => evaluateRow(row, ctx)));
}

export interface Baseline {
  metrics: EvalMetrics;
  rows?: number;
}

/** Each metric that fell below the baseline, as a sentence. */
export function metricDrops(metrics: EvalMetrics, baseline: Baseline): string[] {
  const drops: string[] = [];
  for (const key of METRIC_KEYS) {
    const was = baseline.metrics[key];
    if (typeof was !== 'number') continue;
    if (round4(metrics[key]) < round4(was)) drops.push(`${key} fell from ${was} to ${round4(metrics[key])}.`);
  }
  return drops;
}

/** Why the gate fails (pinned failures and metric drops); empty when it passes. */
export function gateFailures(report: EvalReport, baseline: Baseline | null): string[] {
  const failures = report.pinnedFailures.map(
    (r) => `Pinned row ${r.id} ("${r.title}") is wrong on ${r.wrong.join(', ')}.`,
  );
  if (baseline) failures.push(...metricDrops(report.metrics, baseline));
  return failures;
}
