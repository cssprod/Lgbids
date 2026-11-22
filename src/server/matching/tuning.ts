import {
  NOTICE_TYPE_LABELS,
  type AutomationSettings,
  type Decision,
  type FeedbackRecord,
  type InsightBreakdown,
  type InsightExample,
  type InsightsDays,
  type MissedBidInput,
  type Profile,
  type RegionSettings,
  type ScoringInsights,
  type SourceConfig,
  type TermInsight,
  type TuningSuggestion,
} from '../../shared/schemas.js';
import type { OpportunityRecord } from '../contracts.js';
import { normalize, phraseRegex } from '../util/text.js';
import { analyse, type AnalyseInput } from './analyse.js';
import type { CorpusRow } from './evaluate.js';
import { assessRelevance } from './relevance.js';

/** Everything the tuning report needs; no I/O happens here. */
export interface TuningInput {
  /** Feedback in the window, newest first. */
  feedback: FeedbackRecord[];
  /** The notices the feedback is about, by opportunity id (a missed bid Lgbids never saw has none). */
  notices: Map<number, OpportunityRecord>;
  profile: Profile;
  automation: AutomationSettings;
  region: RegionSettings;
  now: Date;
  days: InsightsDays;
  /** Start of the window, or null for all time. */
  since: string | null;
  /** Zone for reading dates while re-scoring; defaults to Victoria. */
  zone?: string;
}

/** An empty report with every list present. */
export function emptyScoringInsights(days: InsightsDays, since: string | null): ScoringInsights {
  return {
    days,
    since,
    counts: { total: 0, notRelevant: 0, missed: 0 },
    terms: [],
    areaRules: [],
    typeRules: [],
    byArea: [],
    bySource: [],
    byNoticeType: [],
    uncovered: [],
    rescore: { fixed: 0, stillWrong: 0, items: [] },
    suggestions: [],
    missed: [],
  };
}

// Suggestions need enough evidence that one odd notice does not drive a rule change (R21).
export const MIN_SUGGESTION_COUNT = 3;
export const MIN_SUGGESTION_SHARE = 0.6;
const MAX_EXAMPLES = 5;
const MAX_ROWS = 25;

// Words that say nothing about the kind of work, so they are never suggested or counted as uncovered.
const STOPWORDS = new Set(
  (
    'a an and are as at be by for from in into is it of on or the to with without our your this that these those ' +
    'services service request requests proposal proposals quote quotes quotation quotations tender tenders bid bids ' +
    'invitation rfp rfq rfi itt itq rfsq rfpq rfeoi eoi notice contract contracts project projects program work works ' +
    'supply supplies provision provide providing various annual year years phase new district city town county region ' +
    'regional municipality capital crd bc british columbia victoria greater no number ref reference'
  ).split(/\s+/),
);

const AREA_LABELS: Record<string, string> = { yes: 'In your area', no: 'Outside your area', unknown: 'Area unclear' };

function example(f: FeedbackRecord): InsightExample {
  return { feedbackId: f.id, opportunityId: f.opportunityId, title: f.title };
}

function addExample(list: InsightExample[], f: FeedbackRecord): void {
  if (list.length < MAX_EXAMPLES && !list.some((e) => e.feedbackId === f.id)) list.push(example(f));
}

/** Counts per key, most errors first. */
function breakdown(feedback: FeedbackRecord[], keyOf: (f: FeedbackRecord) => string | null, labelOf: (key: string) => string): InsightBreakdown[] {
  const rows = new Map<string, InsightBreakdown>();
  for (const f of feedback) {
    const key = keyOf(f);
    if (key === null) continue;
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { key, label: labelOf(key), notRelevant: 0, missed: 0, examples: [] }));
    if (f.verdict === 'not_relevant') row.notRelevant += 1;
    else row.missed += 1;
    addExample(row.examples, f);
  }
  return [...rows.values()].sort((a, b) => b.notRelevant + b.missed - (a.notRelevant + a.missed) || a.key.localeCompare(b.key)).slice(0, MAX_ROWS);
}

/** "area.local_buyer" → "Local buyer". */
function ruleLabel(rule: string): string {
  const tail = rule.replace(/^[a-z]+\./, '').replace(/_/g, ' ');
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : rule;
}

/** Lower-case words of a title, without stopwords, numbers or one-letter bits. */
export function titleWords(title: string): string[] {
  return normalize(title)
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w));
}

/** Word groups (one to three words) taken from runs of meaningful words, so a group never spans a stopword. */
export function titleNgrams(title: string, max = 3): string[] {
  const runs: string[][] = [[]];
  for (const raw of normalize(title).split(/[^a-z0-9']+/)) {
    const w = raw.replace(/^'+|'+$/g, '');
    if (w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w)) runs[runs.length - 1]!.push(w);
    else if (runs[runs.length - 1]!.length) runs.push([]);
  }
  const out = new Set<string>();
  for (const run of runs) {
    for (let n = 1; n <= max; n++) for (let i = 0; i + n <= run.length; i++) out.add(run.slice(i, i + n).join(' '));
  }
  return [...out];
}

/** True when no vocabulary term matches the phrase on its own. */
function uncoveredByTerms(phrase: string): boolean {
  return assessRelevance({ title: phrase }).matches.length === 0;
}

/** What a reported missed bid is scored from: only what the user typed or pasted. */
export function missedAnalyseInput(input: Pick<MissedBidInput, 'title' | 'organization' | 'text' | 'url'>): AnalyseInput {
  return {
    title: input.title,
    organization: input.organization,
    description: input.text,
    location: '',
    categories: [],
    noticeTypeHint: '',
    closesAt: null,
    closesAtPrecision: null,
    status: 'open',
    url: input.url,
    documentText: '',
    localSource: false,
    bcSource: false,
    sourceSubmission: 'unknown',
  };
}

/**
 * The notice as the pipeline scores it. Without the source settings, a local
 * buyer is recognised from the area rule it was first scored with.
 */
export function noticeAnalyseInput(opp: OpportunityRecord, cfg?: Pick<SourceConfig, 'localBuyer' | 'bcOnly' | 'defaultSubmission'>, feedback?: FeedbackRecord): AnalyseInput {
  const localSource = cfg ? cfg.localBuyer : (feedback?.trace?.areaRule ?? opp.analysis?.trace?.areaRule ?? '').startsWith('area.local_buyer');
  return {
    title: opp.title,
    organization: opp.organization,
    description: opp.description,
    location: opp.location,
    categories: opp.categories,
    noticeTypeHint: `${opp.noticeTypeHint} ${opp.referenceNumber}`.trim(),
    closesAt: opp.closesAt,
    closesAtPrecision: opp.closesAtPrecision,
    status: opp.status,
    url: opp.url,
    documentText: opp.documentText,
    localSource,
    bcSource: opp.bcSource || localSource || !!cfg?.bcOnly,
    sourceSubmission: cfg?.defaultSubmission ?? 'unknown',
  };
}

/** Whether a decision now agrees with the feedback: not relevant should be unsuitable; a missed bid should at least be shown for review. */
function agrees(verdict: FeedbackRecord['verdict'], decision: Decision | null): boolean {
  if (decision === null) return false;
  return verdict === 'not_relevant' ? decision === 'unsuitable' : decision !== 'unsuitable';
}

/**
 * A row for the matching corpus (the MAT-1 format) from one feedback item.
 * Only public notice fields go in: no profile, no settings, no user note.
 */
export function corpusRowFor(f: FeedbackRecord, opp: OpportunityRecord | undefined, cfg?: Pick<SourceConfig, 'localBuyer' | 'bcOnly' | 'defaultSubmission'>): CorpusRow {
  const input = opp ? noticeAnalyseInput(opp, cfg, f) : missedAnalyseInput({ title: f.title, organization: f.organization, text: '', url: f.url });
  const relevant = f.verdict === 'missed';
  const area = f.reasons.includes('outside_area') ? 'no' : f.reasons.includes('in_area') ? 'yes' : f.area;
  return {
    id: `beta-${f.id}`,
    origin: 'beta',
    pinned: false,
    note: `${relevant ? 'Missed' : 'Not relevant'} (beta feedback${f.reasons.length ? `: ${f.reasons.join(', ')}` : ''}).`,
    title: input.title,
    organization: input.organization,
    description: input.description,
    location: input.location,
    categories: input.categories,
    noticeTypeHint: input.noticeTypeHint,
    closesAt: input.closesAt,
    closesAtPrecision: input.closesAtPrecision,
    status: input.status,
    url: input.url,
    // Document text can be very long; the notice text is enough for a corpus row.
    documentText: '',
    localSource: input.localSource,
    bcSource: input.bcSource,
    sourceSubmission: input.sourceSubmission,
    expected: { relevant, decision: relevant ? 'suitable' : 'unsuitable', area, type: f.noticeType },
  };
}

function share(count: number, total: number): number {
  return total ? Math.round((count / total) * 100) / 100 : 0;
}

/**
 * Rule-based tuning report from feedback (MAT-13): which terms, area rules and
 * type rules were behind wrong scores, which words in missed titles no term
 * covers, whether today's rules would now get each item right, and a few
 * suggestions backed by enough items. Nothing is applied automatically.
 */
export function scoringInsights(input: TuningInput): ScoringInsights {
  const { feedback } = input;
  const report = emptyScoringInsights(input.days, input.since);
  const notRelevant = feedback.filter((f) => f.verdict === 'not_relevant');
  const missed = feedback.filter((f) => f.verdict === 'missed');
  report.counts = { total: feedback.length, notRelevant: notRelevant.length, missed: missed.length };
  if (!feedback.length) return report;

  // --- Terms behind false positives -------------------------------------------
  const terms = new Map<string, TermInsight>();
  const termMissed = new Map<string, number>();
  for (const f of feedback) {
    const matches = f.trace?.matches.length
      ? f.trace.matches
      : f.matchedTerms.map((term) => ({ term, strength: 2, where: 'body' as const }));
    const seen = new Set<string>();
    for (const m of matches) {
      if (seen.has(m.term)) continue;
      seen.add(m.term);
      if (f.verdict === 'missed') {
        termMissed.set(m.term, (termMissed.get(m.term) ?? 0) + 1);
        continue;
      }
      let row = terms.get(m.term);
      if (!row) terms.set(m.term, (row = { term: m.term, falsePositives: 0, decisive: 0, supporting: 0, inTitle: 0, inBody: 0, examples: [] }));
      row.falsePositives += 1;
      if (m.strength >= 3) row.decisive += 1;
      else row.supporting += 1;
      if (m.where === 'title') row.inTitle += 1;
      else row.inBody += 1;
      addExample(row.examples, f);
    }
  }
  report.terms = [...terms.values()].sort((a, b) => b.falsePositives - a.falsePositives || a.term.localeCompare(b.term)).slice(0, MAX_ROWS);

  // --- Rules and groupings ----------------------------------------------------
  report.areaRules = breakdown(feedback, (f) => f.trace?.areaRule ?? null, ruleLabel);
  report.typeRules = breakdown(feedback, (f) => f.trace?.typeRule ?? null, ruleLabel);
  report.byArea = breakdown(feedback, (f) => f.area, (k) => AREA_LABELS[k] ?? k);
  report.bySource = breakdown(feedback, (f) => f.sourceId || 'reported', (k) => (k === 'reported' ? 'Reported by you' : ([...input.notices.values()].find((n) => n.sourceId === k)?.sourceName ?? k)));
  report.byNoticeType = breakdown(feedback, (f) => f.noticeType, (k) => NOTICE_TYPE_LABELS[k as keyof typeof NOTICE_TYPE_LABELS] ?? k);

  // --- Word groups in missed titles that no term covers ------------------------
  const uncovered = new Map<string, { ngram: string; count: number; examples: InsightExample[] }>();
  for (const f of missed) {
    for (const ngram of titleNgrams(f.title)) {
      if (!uncoveredByTerms(ngram)) continue;
      let row = uncovered.get(ngram);
      if (!row) uncovered.set(ngram, (row = { ngram, count: 0, examples: [] }));
      row.count += 1;
      addExample(row.examples, f);
    }
  }
  report.uncovered = [...uncovered.values()]
    .sort((a, b) => b.count - a.count || b.ngram.split(' ').length - a.ngram.split(' ').length || a.ngram.localeCompare(b.ngram))
    .slice(0, MAX_ROWS);

  // --- Score every item again under today's rules -----------------------------
  const ctx = { profile: input.profile, automation: input.automation, region: input.region, now: input.now, zone: input.zone ?? 'America/Vancouver' };
  for (const f of feedback) {
    const notice = f.opportunityId === null ? undefined : input.notices.get(f.opportunityId);
    const after = analyse(notice ? noticeAnalyseInput(notice, undefined, f) : missedAnalyseInput({ title: f.title, organization: f.organization, text: '', url: f.url }), ctx).decision;
    const fixed = agrees(f.verdict, after);
    if (fixed) report.rescore.fixed += 1;
    else report.rescore.stillWrong += 1;
    report.rescore.items.push({ feedbackId: f.id, opportunityId: f.opportunityId, title: f.title, verdict: f.verdict, before: f.decision, after, fixed });
  }

  // --- Suggestions (never applied automatically) ------------------------------
  const suggestions: TuningSuggestion[] = [];
  const excluded = input.automation.excludeKeywords.map((k) => normalize(k));
  const qualifies = (count: number, total: number) => count >= MIN_SUGGESTION_COUNT && share(count, total) >= MIN_SUGGESTION_SHARE;

  // Words in titles marked not relevant that are not vocabulary terms: candidates for excluded words.
  const wordCounts = new Map<string, { nr: number; all: number }>();
  for (const f of feedback) {
    for (const w of new Set(titleWords(f.title))) {
      const row = wordCounts.get(w) ?? { nr: 0, all: 0 };
      row.all += 1;
      if (f.verdict === 'not_relevant') row.nr += 1;
      wordCounts.set(w, row);
    }
  }
  for (const [word, c] of wordCounts) {
    if (!qualifies(c.nr, c.all) || excluded.includes(word) || !uncoveredByTerms(word)) continue;
    if (excluded.some((k) => phraseRegex(k)?.test(word))) continue;
    suggestions.push({
      kind: 'exclude_keyword',
      value: word,
      count: c.nr,
      share: share(c.nr, c.all),
      message: `Add “${word}” to excluded words: it is in the title of ${c.nr} bids you marked not relevant.`,
    });
  }

  for (const t of terms.values()) {
    const all = t.falsePositives + (termMissed.get(t.term) ?? 0);
    if (!qualifies(t.falsePositives, all)) continue;
    suggestions.push({
      kind: 'term',
      value: t.term,
      count: t.falsePositives,
      share: share(t.falsePositives, all),
      message: `The term “${t.term}” counted in ${t.falsePositives} bids you marked not relevant; it may need a narrower rule.`,
    });
  }

  // Places that were read as in the area, but the bids were outside it.
  const places = new Map<string, { nr: number; all: number }>();
  for (const f of feedback) {
    if (f.area !== 'yes' || !f.areaMatch) continue;
    const row = places.get(f.areaMatch) ?? { nr: 0, all: 0 };
    row.all += 1;
    if (f.verdict === 'not_relevant' && f.reasons.includes('outside_area')) row.nr += 1;
    places.set(f.areaMatch, row);
  }
  for (const [place, c] of places) {
    if (!qualifies(c.nr, c.all)) continue;
    suggestions.push({
      kind: 'place',
      value: place,
      count: c.nr,
      share: share(c.nr, c.all),
      message: `Check whether “${place}” belongs in your service area: ${c.nr} bids placed there were outside it.`,
    });
  }
  report.suggestions = suggestions.sort((a, b) => b.count - a.count || b.share - a.share || a.value.localeCompare(b.value)).slice(0, MAX_ROWS);

  report.missed = missed.map((f) => ({
    feedbackId: f.id,
    opportunityId: f.opportunityId,
    title: f.title,
    url: f.url,
    organization: f.organization,
    score: f.score,
    decision: f.decision,
    createdAt: f.createdAt,
  }));
  return report;
}
