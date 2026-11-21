import type { ApplicationStatus, ResultsInsights } from '../../shared/schemas.js';
import { match, notBuilt, ok, type MockModule } from './context.js';

const EMPTY_RESULTS: ResultsInsights = { submitted: 0, won: 0, lost: 0, awaiting: 0, winRate: null, decided: 0, valueWon: 0, byBuyer: [], byType: [], recent: [] };

/** Application results (won, not awarded, withdrawn), awards (UX-5, UX-11) and the Results insights (UX-12). */
export const awards: MockModule = (ctx, { method, path, body }) => {
  let r: RegExpExecArray | null;
  if ((r = match(path, /^\/api\/applications\/(\d+)\/status$/)) && method === 'POST') {
    return ctx.updateApp(Number(r[1]), (x) => ctx.recompute({ ...x, status: body.status as ApplicationStatus }));
  }
  if (match(path, /^\/api\/opportunities\/\d+\/award$/) && (method === 'PUT' || method === 'DELETE')) return notBuilt();
  if (path === '/api/insights/results') return ok(EMPTY_RESULTS);
  return null;
};
