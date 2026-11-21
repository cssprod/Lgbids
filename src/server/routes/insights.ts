import type { FastifyInstance } from 'fastify';
import type { InsightsDays, ResultsInsights, ScoringInsights } from '../../shared/schemas.js';
import type { OpportunityRecord } from '../contracts.js';
import { resultsInsights } from '../insights.js';
import { scoringInsights } from '../matching/tuning.js';
import { ApiError, query, type RouteContext } from './util.js';

const DAY_MS = 86_400_000;

/** `?days=7|30|all`; missing means 30. */
export function parseInsightsDays(raw: string | undefined): InsightsDays {
  if (raw === undefined || raw === '') return 30;
  if (raw === '7') return 7;
  if (raw === '30') return 30;
  if (raw === 'all') return 'all';
  throw new ApiError(400, 'Choose 7, 30 or all for the number of days to look back.');
}

/**
 * Insights. This module only validates and gathers; the work is done by
 * scoringInsights() (pure, matching/tuning.ts) and resultsInsights() (insights.ts).
 */
export function registerInsights(app: FastifyInstance, ctx: RouteContext): void {
  const { store, settings } = ctx.deps;

  app.get('/api/insights/scoring', async (req): Promise<ScoringInsights> => {
    const days = parseInsightsDays(query(req).days);
    const now = ctx.deps.now();
    const since = days === 'all' ? null : new Date(now.getTime() - days * DAY_MS).toISOString();
    const feedback = store.listFeedback(since ? { sinceIso: since } : {});
    const notices = new Map<number, OpportunityRecord>();
    for (const item of feedback) {
      if (item.opportunityId === null || notices.has(item.opportunityId)) continue;
      const record = store.getOpportunity(item.opportunityId);
      if (record) notices.set(item.opportunityId, record);
    }
    return scoringInsights({
      feedback,
      notices,
      profile: settings.getProfile(),
      automation: settings.getAutomation(),
      region: settings.getRegion(),
      now,
      days,
      since,
    });
  });

  app.get('/api/insights/results', async (): Promise<ResultsInsights> => resultsInsights(ctx.deps));
}
