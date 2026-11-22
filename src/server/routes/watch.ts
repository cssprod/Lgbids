import type { FastifyInstance } from 'fastify';
import { muteSchema, type Opportunity } from '../../shared/schemas.js';
import { idParam, notFound, opportunityDto, parseBody, type RouteContext } from './util.js';

/** Watching a bid: the per-bid mute switch (UX-7) and "Got it" on its changes (MAT-15). */
export function registerWatch(app: FastifyInstance, ctx: RouteContext): void {
  const { store, now } = ctx.deps;

  function detail(id: number): Opportunity {
    const record = store.getOpportunity(id);
    if (!record) throw notFound('opportunity');
    return { ...opportunityDto(record), changes: store.listChanges(id) };
  }

  app.post('/api/opportunities/:id/alerts', async (req) => {
    const id = idParam(req, 'opportunity');
    const { muted } = parseBody(muteSchema, req.body);
    const opp = store.getOpportunity(id);
    if (!opp || !store.setAlertsMuted(id, muted)) throw notFound('opportunity');
    store.addEvent(
      {
        level: 'info',
        kind: 'alerts_muted',
        message: muted ? `You switched off reminders and change alerts for “${opp.title}”.` : `You switched on reminders and change alerts for “${opp.title}”.`,
        opportunityId: id,
        applicationId: null,
        runId: null,
      },
      now(),
    );
    return detail(id);
  });

  app.post('/api/opportunities/:id/changes/seen', async (req) => {
    const id = idParam(req, 'opportunity');
    if (!store.getOpportunity(id)) throw notFound('opportunity');
    store.markChangesSeen(id, now());
    return detail(id);
  });
}
