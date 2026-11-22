import type { FastifyInstance } from 'fastify';
import { awardInputSchema, type Award } from '../../shared/schemas.js';
import { organizationKey } from '../matching/geo.js';
import { referenceKey } from '../matching/notice.js';
import { idParam, notFound, parseBody, type RouteContext } from './util.js';

/**
 * Who won a bid (UX-11). The person's PUT is the only thing that confirms a
 * result: a value read from an award notice stays a suggestion until then.
 */
export function registerAwards(app: FastifyInstance, ctx: RouteContext): void {
  const { store, now } = ctx.deps;

  app.put('/api/opportunities/:id/award', async (req): Promise<Award> => {
    const id = idParam(req, 'opportunity');
    const opp = store.getOpportunity(id);
    if (!opp) throw notFound('opportunity');
    const input = parseBody(awardInputSchema, req.body);
    const existing = store.getAwardFor(id);
    // Confirming a notice's values unchanged keeps them marked as read from the notice.
    const fromNotice = existing?.origin === 'parsed' && existing.winner === input.winner && existing.amount === input.amount ? existing : null;
    const at = now();
    const award = store.saveAward(
      {
        opportunityId: id,
        noticeOpportunityId: existing?.noticeOpportunityId ?? null,
        orgKey: existing?.orgKey || organizationKey(opp.organization),
        refKey: existing?.refKey || (opp.referenceNumber ? referenceKey(opp.referenceNumber) : ''),
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
      },
      at,
    );
    const application = store.getApplicationByOpportunity(id);
    store.addEvent(
      {
        level: 'info',
        kind: 'award_confirmed',
        message: `You recorded ${input.winner} as the winner of “${opp.title}”.`,
        opportunityId: id,
        applicationId: application?.id ?? null,
        runId: null,
      },
      at,
    );
    return award;
  });

  app.delete('/api/opportunities/:id/award', async (req) => {
    const id = idParam(req, 'opportunity');
    if (!store.getOpportunity(id)) throw notFound('opportunity');
    store.deleteAwardFor(id);
    return { ok: true as const };
  });
}
