import type { FastifyInstance } from 'fastify';
import { notBuilt, type RouteContext } from './util.js';

/** Stub from the v2 foundation (UX-6a): the owning work package replaces each handler. */
export function registerStatus(app: FastifyInstance, _ctx: RouteContext): void {
  app.get('/api/status', async () => notBuilt());
}
