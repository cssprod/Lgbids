import type { FastifyInstance } from 'fastify';
import { notBuilt, type RouteContext } from './util.js';

/** Stub from the v2 foundation (UX-6a): the owning work package replaces each handler. */
export function registerSearches(app: FastifyInstance, _ctx: RouteContext): void {
  app.get('/api/saved-searches', async () => notBuilt());
  app.post('/api/saved-searches', async () => notBuilt());
  app.patch('/api/saved-searches/:id', async () => notBuilt());
  app.delete('/api/saved-searches/:id', async () => notBuilt());
}
