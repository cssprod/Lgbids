import type { FastifyInstance } from 'fastify';
import { notBuilt, type RouteContext } from './util.js';

/** Stub from the v2 foundation (UX-6a): the owning work package replaces each handler. */
export function registerAwards(app: FastifyInstance, _ctx: RouteContext): void {
  app.put('/api/opportunities/:id/award', async () => notBuilt());
  app.delete('/api/opportunities/:id/award', async () => notBuilt());
}
