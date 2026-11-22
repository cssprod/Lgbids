import {
  FEEDBACK_REASONS,
  NOTICE_TYPE_LABELS,
  type FeedbackReason,
  type FeedbackRecord,
  type InsightBreakdown,
  type InsightExample,
  type InsightsDays,
  type Opportunity,
  type ScoringInsights,
  type TuningSuggestion,
} from '../../shared/schemas.js';
import { fail, match, ok, type MockContext, type MockModule } from './context.js';

/**
 * Feedback on scores and the Scoring insights (MAT-12, UX-9, UX-10), kept in
 * the prototype state. The answers and sentences follow
 * src/server/routes/feedback.ts; the report is a lighter stand-in for
 * src/server/matching/tuning.ts: it does not score items again, and the
 * Scoring page leaves out suggestions already in the excluded words.
 */

const NOT_FOUND = 'That opportunity could not be found. It may have been deleted.';
const MIN_COUNT = 3;
const MIN_SHARE = 0.6;
const STOPWORDS = new Set(
  'a an and are as at be by for from in into is it of on or the to with our this that services service request proposal proposals quote quotation tender tenders bid bids rfp rfq notice contract project work works supply various annual year new district city town regional victoria'.split(' '),
);

function words(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w));
}

function snapshot(o: Opportunity): Omit<FeedbackRecord, 'id' | 'opportunityId' | 'verdict' | 'reasons' | 'note' | 'foundVia' | 'createdAt'> {
  const a = o.analysis;
  return {
    title: o.title,
    url: o.url,
    organization: o.organization,
    sourceId: o.sourceId,
    noticeType: o.noticeType,
    score: o.suitabilityScore,
    decision: o.decision,
    matchedTerms: a?.matchedTerms ?? [],
    services: a?.services ?? [],
    area: a?.area ?? 'unknown',
    areaMatch: a?.areaMatch ?? '',
    trace: a?.trace ?? null,
    lexiconVersion: a?.trace?.lexiconVersion ?? 'prototype',
  };
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function reasonsFrom(v: unknown): FeedbackReason[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((r) => (FEEDBACK_REASONS as readonly string[]).includes(r))) return null;
  return v as FeedbackReason[];
}

const example = (f: FeedbackRecord): InsightExample => ({ feedbackId: f.id, opportunityId: f.opportunityId, title: f.title });

function breakdown(items: FeedbackRecord[], keyOf: (f: FeedbackRecord) => string, labelOf: (k: string) => string): InsightBreakdown[] {
  const rows = new Map<string, InsightBreakdown>();
  for (const f of items) {
    const key = keyOf(f);
    const row = rows.get(key) ?? { key, label: labelOf(key), notRelevant: 0, missed: 0, examples: [] };
    if (f.verdict === 'not_relevant') row.notRelevant += 1;
    else row.missed += 1;
    if (row.examples.length < 5) row.examples.push(example(f));
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.notRelevant + b.missed - (a.notRelevant + a.missed));
}

export function mockScoring(ctx: MockContext, days: InsightsDays): ScoringInsights {
  const since = days === 'all' ? null : new Date(Date.now() - days * 86_400_000).toISOString();
  const items = ctx.state.v2.feedback.filter((f) => !since || f.createdAt >= since);
  const nr = items.filter((f) => f.verdict === 'not_relevant');
  const missedItems = items.filter((f) => f.verdict === 'missed');
  const sourceName = (id: string) => (id === 'reported' ? 'Reported by you' : (ctx.state.sources.find((s) => s.id === id)?.name ?? id));
  const known = new Set<string>(ctx.state.opportunities.flatMap((o) => o.analysis?.matchedTerms ?? []).map((t) => t.toLowerCase()));

  const terms = new Map<string, ScoringInsights['terms'][number]>();
  for (const f of nr) {
    for (const term of new Set(f.matchedTerms)) {
      const row = terms.get(term) ?? { term, falsePositives: 0, decisive: 0, supporting: 0, inTitle: 0, inBody: 0, examples: [] };
      row.falsePositives += 1;
      row.supporting += 1;
      if (f.title.toLowerCase().includes(term.toLowerCase())) row.inTitle += 1;
      else row.inBody += 1;
      if (row.examples.length < 5) row.examples.push(example(f));
      terms.set(term, row);
    }
  }

  const uncovered = new Map<string, { ngram: string; count: number; examples: InsightExample[] }>();
  for (const f of missedItems) {
    for (const w of new Set(words(f.title))) {
      if (known.has(w)) continue;
      const row = uncovered.get(w) ?? { ngram: w, count: 0, examples: [] };
      row.count += 1;
      if (row.examples.length < 5) row.examples.push(example(f));
      uncovered.set(w, row);
    }
  }

  const suggestions: TuningSuggestion[] = [];
  const counts = new Map<string, { nr: number; all: number }>();
  for (const f of items) {
    for (const w of new Set(words(f.title))) {
      const c = counts.get(w) ?? { nr: 0, all: 0 };
      c.all += 1;
      if (f.verdict === 'not_relevant') c.nr += 1;
      counts.set(w, c);
    }
  }
  for (const [w, c] of counts) {
    const share = Math.round((c.nr / c.all) * 100) / 100;
    if (c.nr < MIN_COUNT || share < MIN_SHARE || known.has(w)) continue;
    suggestions.push({ kind: 'exclude_keyword', value: w, count: c.nr, share, message: `Add “${w}” to excluded words: it is in the title of ${c.nr} bids you marked not relevant.` });
  }

  return {
    days,
    since,
    counts: { total: items.length, notRelevant: nr.length, missed: missedItems.length },
    terms: [...terms.values()].sort((a, b) => b.falsePositives - a.falsePositives),
    areaRules: breakdown(items.filter((f) => f.trace), (f) => f.trace!.areaRule, (k) => k),
    typeRules: breakdown(items.filter((f) => f.trace), (f) => f.trace!.typeRule, (k) => k),
    byArea: breakdown(items, (f) => f.area, (k) => ({ yes: 'In your area', no: 'Outside your area', unknown: 'Area unclear' })[k] ?? k),
    bySource: breakdown(items, (f) => f.sourceId || 'reported', sourceName),
    byNoticeType: breakdown(items, (f) => f.noticeType, (k) => NOTICE_TYPE_LABELS[k as keyof typeof NOTICE_TYPE_LABELS] ?? k),
    uncovered: [...uncovered.values()].sort((a, b) => b.count - a.count).slice(0, 25),
    rescore: {
      fixed: 0,
      stillWrong: items.length,
      items: items.map((f) => ({ feedbackId: f.id, opportunityId: f.opportunityId, title: f.title, verdict: f.verdict, before: f.decision, after: f.decision, fixed: false })),
    },
    suggestions,
    missed: missedItems.map((f) => ({ feedbackId: f.id, opportunityId: f.opportunityId, title: f.title, url: f.url, organization: f.organization, score: f.score, decision: f.decision, createdAt: f.createdAt })),
  };
}

export const feedback: MockModule = (ctx, { method, path, q, body }) => {
  const list = () => ctx.state.v2.feedback;
  let r: RegExpExecArray | null;
  if ((r = match(path, /^\/api\/opportunities\/(\d+)\/feedback$/)) && (method === 'PUT' || method === 'DELETE')) {
    const id = Number(r[1]);
    const o = ctx.state.opportunities.find((x) => x.id === id);
    if (!o) return fail(404, NOT_FOUND);
    const previous = list().find((f) => f.opportunityId === id);
    if (method === 'DELETE') {
      ctx.state.v2.feedback = list().filter((f) => f.opportunityId !== id);
      if (previous?.verdict === 'not_relevant' && o.userDecision === 'dismissed') o.userDecision = null;
      return ok({ ok: true });
    }
    const verdict = body.verdict;
    const reasons = reasonsFrom(body.reasons);
    if ((verdict !== 'not_relevant' && verdict !== 'missed') || !reasons) return fail(400, 'Please check “verdict” and “reasons”: choose Not relevant or Missed, and reasons from the list.');
    const saved: FeedbackRecord = { ...snapshot(o), id: ctx.newId(), opportunityId: id, verdict, reasons, note: str(body.note, 1000), foundVia: '', createdAt: new Date().toISOString() };
    ctx.state.v2.feedback = [saved, ...list().filter((f) => f.opportunityId !== id)];
    // D18: "Not relevant" also dismisses; an unsent application is withdrawn, as on the server.
    if (verdict === 'not_relevant' && o.userDecision !== 'dismissed') {
      o.userDecision = 'dismissed';
      const a = ctx.state.applications.find((x) => x.opportunityId === id);
      if (a && ['needs_input', 'ready', 'failed'].includes(a.status)) ctx.updateApp(a.id, (x) => ({ ...x, status: 'withdrawn' }));
    }
    return ok(saved);
  }
  if (path === '/api/feedback/missed' && method === 'POST') {
    const title = str(body.title, 300);
    if (title.length < 3) return fail(400, 'Please check “title”: give the bid’s title, at least three letters long.');
    const saved: FeedbackRecord = {
      id: ctx.newId(),
      opportunityId: null,
      verdict: 'missed',
      reasons: [],
      note: str(body.note, 1000),
      title,
      url: str(body.url, 1000),
      organization: str(body.organization, 200),
      foundVia: str(body.foundVia, 200),
      sourceId: '',
      noticeType: 'OTHER',
      score: null,
      decision: null,
      matchedTerms: [],
      services: [],
      area: 'unknown',
      areaMatch: '',
      trace: null,
      lexiconVersion: 'prototype',
      createdAt: new Date().toISOString(),
    };
    ctx.state.v2.feedback = [saved, ...list()];
    return ok(saved);
  }
  if (path === '/api/feedback' && method === 'GET') return ok(list());
  if (path === '/api/insights/scoring') {
    const raw = q.get('days') ?? '30';
    if (!['7', '30', 'all'].includes(raw)) return fail(400, 'Choose 7, 30 or all for the number of days to look back.');
    return ok(mockScoring(ctx, raw === 'all' ? 'all' : (Number(raw) as 7 | 30)));
  }
  return null;
};
