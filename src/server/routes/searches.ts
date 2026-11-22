import type { FastifyInstance } from 'fastify';
import { MAX_SAVED_SEARCHES, savedSearchInputSchema, savedSearchPatchSchema, type SavedSearch } from '../../shared/schemas.js';
import { ApiError, idParam, notFound, parseBody, type RouteContext } from './util.js';

const taken = (name: string) => new ApiError(409, `You already have a search called “${name}”. Choose another name.`);

/** Saved searches (UX-13): named list filters, at most 20, names unique ignoring case. */
export function registerSearches(app: FastifyInstance, ctx: RouteContext): void {
  const { store, now } = ctx.deps;

  app.get('/api/saved-searches', async (): Promise<SavedSearch[]> => store.listSavedSearches());

  app.post('/api/saved-searches', async (req): Promise<SavedSearch> => {
    const input = parseBody(savedSearchInputSchema, req.body);
    if (store.listSavedSearches().length >= MAX_SAVED_SEARCHES) {
      throw new ApiError(409, `You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Delete one you no longer use, then save this one.`);
    }
    const saved = store.createSavedSearch(input, now());
    if (!saved) throw taken(input.name);
    return saved;
  });

  app.patch('/api/saved-searches/:id', async (req): Promise<SavedSearch> => {
    const id = idParam(req, 'saved search');
    const patch = parseBody(savedSearchPatchSchema, req.body);
    const saved = store.updateSavedSearch(id, patch);
    if (saved === undefined) throw notFound('saved search');
    if (saved === null) throw taken(patch.name ?? '');
    return saved;
  });

  app.delete('/api/saved-searches/:id', async (req) => {
    const id = idParam(req, 'saved search');
    if (!store.deleteSavedSearch(id)) throw notFound('saved search');
    return { ok: true as const };
  });
}
