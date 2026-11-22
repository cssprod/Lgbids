import { awardInputSchema, type ApplicationStatus, type Award, type ResultsInsights } from '../../shared/schemas.js';
import { fail, match, ok, type MockModule } from './context.js';

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
  if ((r = match(path, /^\/api\/opportunities\/(\d+)\/award$/)) && (method === 'PUT' || method === 'DELETE')) {
    const id = Number(r[1]);
    const opp = ctx.state.opportunities.find((o) => o.id === id);
    if (!opp) return fail(404, 'That opportunity could not be found. It may have been deleted.');
    const list = ctx.state.v2.awards;
    const at = list.findIndex((a) => a.opportunityId === id);
    if (method === 'DELETE') {
      if (at >= 0) list.splice(at, 1);
      return ok({ ok: true });
    }
    // Same rules as the server: only this PUT confirms a result.
    const parsed = awardInputSchema.safeParse(body);
    if (!parsed.success) return fail(400, 'Please check the winner (1 to 200 characters), the price (0 or more) and the date.');
    const input = parsed.data;
    const existing = at >= 0 ? list[at] : undefined;
    const fromNotice = existing?.origin === 'parsed' && existing.winner === input.winner && existing.amount === input.amount ? existing : undefined;
    const award: Award = {
      id: existing?.id ?? ctx.newId(),
      opportunityId: id,
      noticeOpportunityId: existing?.noticeOpportunityId ?? null,
      orgKey: existing?.orgKey ?? '',
      refKey: existing?.refKey ?? '',
      title: opp.title,
      winner: input.winner,
      amount: input.amount,
      amountText: fromNotice?.amountText ?? '',
      awardedOn: input.awardedOn,
      url: existing?.url || opp.url,
      excerpt: fromNotice?.excerpt ?? '',
      origin: fromNotice ? 'parsed' : 'manual',
      status: 'confirmed',
      notes: input.notes,
      updatedAt: new Date().toISOString(),
    };
    if (at >= 0) list[at] = award;
    else list.push(award);
    return ok(award);
  }
  if (path === '/api/insights/results') return ok(EMPTY_RESULTS);
  return null;
};
