import type { FastifyInstance } from 'fastify';
import type { RunState } from '../../shared/api.js';
import { buildDashboard } from '../dashboard.js';
import { buildCalendar } from './calendar.js';
import { ApiError, intQuery, opportunityDto, query, type RouteContext } from './util.js';

export function registerRuns(app: FastifyInstance, ctx: RouteContext): void {
  const { store, now, config } = ctx.deps;
  const { pipeline, scheduler } = ctx;

  app.get('/api/dashboard', async () => buildDashboard(ctx.deps, pipeline, scheduler));

  app.get('/api/runs', async (req) => store.listRuns(intQuery(query(req).limit, 20, 1, 200)));

  app.post('/api/runs', async (req, reply): Promise<RunState> => {
    if (pipeline.isRunning()) throw new ApiError(409, 'A search is already running. It will finish on its own.');
    // The run can take minutes; the UI polls /api/runs/current for progress.
    pipeline.run('manual').catch((err: unknown) => req.log.error({ err }, 'manual run failed'));
    reply.code(202);
    return { running: true, run: store.latestRun() ?? null };
  });

  app.get('/api/runs/current', async (): Promise<RunState> => ({ running: pipeline.isRunning(), run: store.latestRun() ?? null }));

  app.get('/api/events', async (req) => store.listEvents(intQuery(query(req).limit, 50, 1, 500)));

  // All suitable open bids, or with ?id= just one (for "Add to calendar" on a bid).
  app.get('/api/calendar.ics', async (req, reply) => {
    const at = now();
    const oneId = query(req).id;
    let items;
    if (oneId !== undefined) {
      const id = intQuery(oneId, 0, 1, Number.MAX_SAFE_INTEGER);
      const record = id ? store.getOpportunity(id) : undefined;
      if (!record) throw new ApiError(404, 'That opportunity no longer exists.');
      const opp = opportunityDto(record);
      if (!opp.closesAt) throw new ApiError(400, 'This bid has no closing date to add to a calendar.');
      items = [opp];
    } else {
      items = store
        .listOpportunities({ view: 'suitable', limit: 500 }, at)
        .items.map(opportunityDto)
        .filter((o) => o.status === 'open' && o.closesAt !== null);
    }
    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .header('content-disposition', `inline; filename="${oneId !== undefined ? `lgbids-bid-${items[0]!.id}` : 'lgbids-closing-dates'}.ics"`)
      .header('cache-control', 'private, no-store')
      .send(buildCalendar(items, at, config.timeZone));
  });
}
