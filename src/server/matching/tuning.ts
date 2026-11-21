import type { AutomationSettings, FeedbackRecord, InsightsDays, Profile, RegionSettings, ScoringInsights } from '../../shared/schemas.js';
import type { OpportunityRecord } from '../contracts.js';

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

/**
 * Rule-based tuning report from feedback (MAT-13). Stub from the v2
 * foundation: only the verdict counts are filled until MAT-13 lands.
 */
export function scoringInsights(input: TuningInput): ScoringInsights {
  const report = emptyScoringInsights(input.days, input.since);
  report.counts.total = input.feedback.length;
  report.counts.notRelevant = input.feedback.filter((f) => f.verdict === 'not_relevant').length;
  report.counts.missed = input.feedback.filter((f) => f.verdict === 'missed').length;
  return report;
}
