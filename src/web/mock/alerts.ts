import type { NoticeChange, Opportunity } from '../../shared/schemas.js';
import { fail, match, ok, type MockContext, type MockModule } from './context.js';

const GONE = 'That opportunity no longer exists.';

/** The bid as the server's detail answer has it: its changes newest first, and the counts kept in step. */
function detail(ctx: MockContext, o: Opportunity): Opportunity {
  const changes: NoticeChange[] = ctx.state.v2.changes
    .filter((c) => c.opportunityId === o.id)
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || b.id - a.id);
  // Refinements (a time added to the same day) are recorded but never counted, as on the server.
  const loud = changes.filter((c) => c.kind !== 'closing_refined');
  o.unseenChanges = loud.filter((c) => c.seenAt === null).length;
  o.lastChangedAt = loud[0]?.detectedAt ?? null;
  return { ...o, changes };
}

/** Watching a bid: the mute switch (UX-7), "Got it" on its changes (MAT-15) and the changes on the detail answer. */
export const alerts: MockModule = (ctx, { method, path, body }) => {
  let r: RegExpExecArray | null;
  const find = (id: string) => ctx.state.opportunities.find((x) => x.id === Number(id));

  if ((r = match(path, /^\/api\/opportunities\/(\d+)$/)) && method === 'GET') {
    const o = find(r[1]!);
    return o ? ok(detail(ctx, o)) : null;
  }
  if (method !== 'POST') return null;
  if ((r = match(path, /^\/api\/opportunities\/(\d+)\/alerts$/))) {
    const o = find(r[1]!);
    if (!o) return fail(404, GONE);
    if (typeof body.muted !== 'boolean') return fail(400, 'Please check “muted”: expected a boolean.');
    o.alertsMuted = body.muted;
    return ok(detail(ctx, o));
  }
  if ((r = match(path, /^\/api\/opportunities\/(\d+)\/changes\/seen$/))) {
    const o = find(r[1]!);
    if (!o) return fail(404, GONE);
    const at = new Date().toISOString();
    ctx.state.v2.changes = ctx.state.v2.changes.map((c) => (c.opportunityId === o.id && c.seenAt === null ? { ...c, seenAt: at } : c));
    return ok(detail(ctx, o));
  }
  return null;
};
