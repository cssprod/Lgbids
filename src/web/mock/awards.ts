import type { ApplicationStatus, ResultsInsights } from '../../shared/schemas.js';
import { fail, match, notBuilt, ok, type MockModule } from './context.js';

const RESULT_CONFLICT = 'Only a submitted application can be marked as won or not awarded.';
const UNDO_CONFLICT = 'Only an application with a result can have its result undone.';
const WITHDRAW_RESULT_CONFLICT = 'This application already has a result, so it cannot be withdrawn. Undo the result first.';

const EMPTY_RESULTS: ResultsInsights = { submitted: 0, won: 0, lost: 0, awaiting: 0, winRate: null, decided: 0, valueWon: 0, byBuyer: [], byType: [], recent: [] };

/** Application results (won, not awarded, withdrawn), awards (UX-5, UX-11) and the Results insights (UX-12). */
export const awards: MockModule = (ctx, { method, path, body }) => {
  let r: RegExpExecArray | null;
  if ((r = match(path, /^\/api\/applications\/(\d+)\/status$/)) && method === 'POST') {
    const id = Number(r[1]);
    const current = ctx.state.applications.find((a) => a.id === id);
    if (!current) return fail(404, 'That application no longer exists.');
    const to = body.status as ApplicationStatus;
    // Same transitions and sentences as src/server/routes/applications.ts.
    const result = current.status === 'won' || current.status === 'lost';
    if ((to === 'won' || to === 'lost') && !(current.status === 'submitted' || result)) return fail(409, RESULT_CONFLICT);
    if (to === 'submitted' && !result) return fail(409, UNDO_CONFLICT);
    if (to === 'withdrawn' && result) return fail(409, WITHDRAW_RESULT_CONFLICT);
    if (to === 'withdrawn' && ['withdrawn', 'expired'].includes(current.status)) return fail(409, 'This application is already closed.');
    if (to === 'won' || to === 'lost' || to === 'submitted') return ctx.updateApp(id, (x) => ({ ...x, status: to, updatedAt: new Date().toISOString() }));
    return ctx.updateApp(id, (x) => ctx.recompute({ ...x, status: to }));
  }
  if (match(path, /^\/api\/opportunities\/\d+\/award$/) && (method === 'PUT' || method === 'DELETE')) return notBuilt();
  if (path === '/api/insights/results') return ok(EMPTY_RESULTS);
  return null;
};
