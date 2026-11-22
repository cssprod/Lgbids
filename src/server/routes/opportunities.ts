import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { OpportunityList, OpportunityViewName } from '../../shared/api.js';
import type { Opportunity } from '../../shared/schemas.js';
import type { OpportunityRecord, OpportunityView } from '../contracts.js';
import { opportunitiesCsvName, opportunitiesCsvText } from '../util/csv.js';
import { ApiError, idParam, intQuery, notFound, opportunityDto, parseBody, query, type RouteContext } from './util.js';

const VIEWS: OpportunityViewName[] = ['suitable', 'review', 'unsuitable', 'closed', 'dismissed', 'all'];

const decisionSchema = z.object({ decision: z.enum(['pursue', 'dismissed']).nullable() });

/**
 * "Not for us": the bid leaves the lists, and an application that has not
 * gone out is withdrawn (a sent one keeps its history). Shared with the
 * feedback route, where "Not relevant" also dismisses (D18).
 */
export function dismissOpportunity(ctx: RouteContext, opp: OpportunityRecord, at: Date): void {
  const { store } = ctx.deps;
  store.setUserDecision(opp.id, 'dismissed');
  const application = store.getApplicationByOpportunity(opp.id);
  if (application) store.transitionApplication(application.id, ['needs_input', 'ready', 'failed'], 'withdrawn', at);
  store.addEvent({ level: 'info', kind: 'opportunity_dismissed', message: `You dismissed “${opp.title}”.`, opportunityId: opp.id, applicationId: application?.id ?? null, runId: null }, at);
}

export function registerOpportunities(app: FastifyInstance, ctx: RouteContext): void {
  const { store, now } = ctx.deps;

  /** The opportunity as the UI shows it, with the other sites that list the same notice. */
  function detail(id: number): Opportunity {
    const record = store.getOpportunity(id);
    if (!record) throw notFound('opportunity');
    const opp: Opportunity = { ...opportunityDto(record), changes: store.listChanges(id), myFeedback: store.getFeedbackFor(id) ?? null };
    if (opp.analysis) {
      opp.analysis = { ...opp.analysis, alsoListed: store.duplicatesOf(id).map((d) => ({ source: d.sourceName, url: d.url })) };
    }
    return opp;
  }

  /** The filters the list accepts; the CSV export takes the same ones. */
  function filterFrom(req: FastifyRequest) {
    const q = query(req);
    const view = (q.view ?? 'all') as OpportunityView;
    if (!VIEWS.includes(view)) throw new ApiError(400, `“${q.view}” is not a list of opportunities. Use one of: ${VIEWS.join(', ')}.`);
    return {
      view,
      q: q.q?.trim().slice(0, 200) || undefined,
      sourceId: q.sourceId || undefined,
      closingWithinDays: q.closingWithinDays ? intQuery(q.closingWithinDays, 7, 1, 365) : undefined,
      limit: intQuery(q.limit, 50, 1, 500),
      offset: intQuery(q.offset, 0, 0, 1_000_000),
    };
  }

  app.get('/api/opportunities', async (req): Promise<OpportunityList> => {
    const filter = filterFrom(req);
    const at = now();
    const { items, total } = store.listOpportunities(filter, at);
    return { items: items.map(opportunityDto), total, counts: store.countOpportunities(at) };
  });

  // Everything that matches the filters (not just one page), for a spreadsheet.
  app.get('/api/opportunities.csv', async (req, reply) => {
    const filter = filterFrom(req);
    const at = now();
    const items: Opportunity[] = [];
    for (let offset = 0; offset < 20_000; offset += 500) {
      const page = store.listOpportunities({ ...filter, limit: 500, offset }, at);
      items.push(...page.items.map(opportunityDto));
      if (page.items.length < 500) break;
    }
    const zone = ctx.deps.config.timeZone;
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${opportunitiesCsvName(at, zone)}"`)
      .header('cache-control', 'private, no-store')
      .send(opportunitiesCsvText(items, zone));
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
      dismissOpportunity(ctx, opp, at);
    } else {
      store.setUserDecision(id, null);
    }
    return detail(id);
  });
}
