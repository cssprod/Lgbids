import type { FastifyInstance } from 'fastify';
import { notBuilt, type RouteContext } from './util.js';

/** Stub from the v2 foundation (UX-6a): the owning work package replaces each handler. */
export function registerWatch(app: FastifyInstance, _ctx: RouteContext): void {
  app.post('/api/opportunities/:id/alerts', async () => notBuilt());
  app.post('/api/opportunities/:id/changes/seen', async () => notBuilt());
}
