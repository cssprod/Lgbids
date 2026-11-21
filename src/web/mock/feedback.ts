import type { InsightsDays, ScoringInsights } from '../../shared/schemas.js';
import { match, notBuilt, ok, type MockModule } from './context.js';

function emptyScoring(days: InsightsDays, feedback: { verdict: string }[]): ScoringInsights {
  return {
    days,
    since: days === 'all' ? null : new Date(Date.now() - days * 86_400_000).toISOString(),
    counts: {
      total: feedback.length,
      notRelevant: feedback.filter((f) => f.verdict === 'not_relevant').length,
      missed: feedback.filter((f) => f.verdict === 'missed').length,
    },
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

/** Feedback on scores and the Scoring insights (MAT-12, UX-9, UX-10). Mirrors the server stubs until then. */
export const feedback: MockModule = (ctx, { method, path, q }) => {
  if (match(path, /^\/api\/opportunities\/\d+\/feedback$/) && (method === 'PUT' || method === 'DELETE')) return notBuilt();
  if (path === '/api/feedback/missed' && method === 'POST') return notBuilt();
  if (path === '/api/feedback' || path === '/api/feedback.csv' || path === '/api/feedback/corpus.jsonl') return notBuilt();
  if (path === '/api/insights/scoring') {
    const raw = q.get('days') ?? '30';
    if (!['7', '30', 'all'].includes(raw)) return { status: 400, body: { error: 'Choose 7, 30 or all for the number of days to look back.' } };
    const days: InsightsDays = raw === 'all' ? 'all' : (Number(raw) as 7 | 30);
    return ok(emptyScoring(days, ctx.state.v2.feedback));
  }
  return null;
};
