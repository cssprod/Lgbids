import type { FastifyInstance } from 'fastify';
import { notBuilt, type RouteContext } from './util.js';

/** Stub from the v2 foundation (UX-6a): the owning work package replaces each handler. */
export function registerManual(app: FastifyInstance, _ctx: RouteContext): void {
  app.post('/api/opportunities/manual', async () => notBuilt());
  app.post('/api/opportunities/paste-alert', async () => notBuilt());
}
