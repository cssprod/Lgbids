import type { ResultsInsights } from '../shared/schemas.js';
import type { AppDeps } from './contracts.js';

export function emptyResultsInsights(): ResultsInsights {
  return { submitted: 0, won: 0, lost: 0, awaiting: 0, winRate: null, decided: 0, valueWon: 0, byBuyer: [], byType: [], recent: [] };
}

/** Win/loss record for the Results tab (UX-12). Stub from the v2 foundation. */
export function resultsInsights(_deps: AppDeps): ResultsInsights {
  return emptyResultsInsights();
}
