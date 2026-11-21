import type { FastifyInstance } from 'fastify';
import { notBuilt, type RouteContext } from './util.js';

/** Stub from the v2 foundation (UX-6a): the owning work package replaces each handler. */
export function registerFeedback(app: FastifyInstance, _ctx: RouteContext): void {
  app.put('/api/opportunities/:id/feedback', async () => notBuilt());
  app.delete('/api/opportunities/:id/feedback', async () => notBuilt());
  app.post('/api/feedback/missed', async () => notBuilt());
  app.get('/api/feedback', async () => notBuilt());
  app.get('/api/feedback.csv', async () => notBuilt());
  app.get('/api/feedback/corpus.jsonl', async () => notBuilt());
}
