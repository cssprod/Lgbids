import type { FastifyInstance } from 'fastify';
import { notBuilt, type RouteContext } from './util.js';

/** Stub from the v2 foundation (UX-6a): the owning work package replaces each handler. */
export function registerRecipients(app: FastifyInstance, _ctx: RouteContext): void {
  app.get('/api/recipients', async () => notBuilt());
  app.post('/api/recipients', async () => notBuilt());
  app.patch('/api/recipients/:id', async () => notBuilt());
  app.delete('/api/recipients/:id', async () => notBuilt());
  app.post('/api/recipients/:id/test', async () => notBuilt());
}
