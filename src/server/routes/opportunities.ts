import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { OpportunityList, OpportunityViewName } from '../../shared/api.js';
import type { Opportunity } from '../../shared/schemas.js';
import type { OpportunityView } from '../contracts.js';
import { ApiError, idParam, intQuery, notFound, opportunityDto, parseBody, query, type RouteContext } from './util.js';

const VIEWS: OpportunityViewName[] = ['suitable', 'review', 'unsuitable', 'closed', 'dismissed', 'all'];

const decisionSchema = z.object({ decision: z.enum(['pursue', 'dismissed']).nullable() });

export function registerOpportunities(app: FastifyInstance, ctx: RouteContext): void {
  const { store, now } = ctx.deps;

  /** The opportunity as the UI shows it, with the other sites that list the same notice. */
  function detail(id: number): Opportunity {
    const record = store.getOpportunity(id);
    if (!record) throw notFound('opportunity');
    const opp = opportunityDto(record);
    if (opp.analysis) {
      opp.analysis = { ...opp.analysis, alsoListed: store.duplicatesOf(id).map((d) => ({ source: d.sourceName, url: d.url })) };
    }
    return opp;
  }

  app.get('/api/opportunities', async (req): Promise<OpportunityList> => {
    const q = query(req);
    const view = (q.view ?? 'all') as OpportunityView;
    if (!VIEWS.includes(view)) throw new ApiError(400, `“${q.view}” is not a list of opportunities. Use one of: ${VIEWS.join(', ')}.`);
    const at = now();
    const { items, total } = store.listOpportunities(
      {
        view,
        q: q.q?.trim().slice(0, 200) || undefined,
        sourceId: q.sourceId || undefined,
        limit: intQuery(q.limit, 50, 1, 500),
        offset: intQuery(q.offset, 0, 0, 1_000_000),
      },
      at,
    );
    return { items: items.map(opportunityDto), total, counts: store.countOpportunities(at) };
  });

  app.get('/api/opportunities/:id', async (req) => detail(idParam(req, 'opportunity')));

  app.post('/api/opportunities/:id/decision', async (req) => {
    const id = idParam(req, 'opportunity');
    const opp = store.getOpportunity(id);
    if (!opp) throw notFound('opportunity');
    const { decision } = parseBody(decisionSchema, req.body);
    const at = now();

    if (decision === 'pursue') {
      if (opp.status !== 'open') throw new ApiError(409, 'This opportunity is no longer open, so an application cannot be prepared.');
      store.setUserDecision(id, 'pursue');
      ctx.pipeline.draftFor(id, { rebuild: false });
      store.addEvent({ level: 'info', kind: 'opportunity_pursued', message: `You chose to pursue “${opp.title}”.`, opportunityId: id, applicationId: null, runId: null }, at);
    } else if (decision === 'dismissed') {
      store.setUserDecision(id, 'dismissed');
      const application = store.getApplicationByOpportunity(id);
      // Only a submission that has not gone out can be withdrawn here; a sent one keeps its history.
      if (application) store.transitionApplication(application.id, ['needs_input', 'ready', 'failed'], 'withdrawn', at);
      store.addEvent({ level: 'info', kind: 'opportunity_dismissed', message: `You dismissed “${opp.title}”.`, opportunityId: id, applicationId: application?.id ?? null, runId: null }, at);
    } else {
      store.setUserDecision(id, null);
    }
    return detail(id);
  });
}
