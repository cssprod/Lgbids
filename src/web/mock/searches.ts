import { MAX_SAVED_SEARCHES, savedSearchInputSchema, savedSearchPatchSchema, type SavedSearch } from '../../shared/schemas.js';
import { fail, match, ok, type MockModule } from './context.js';

const taken = (name: string) => fail(409, `You already have a search called “${name}”. Choose another name.`);
const gone = () => fail(404, 'That saved search could not be found. It may have been deleted.');
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Saved searches (UX-13), with the server's limits and sentences; kept in the prototype state. */
export const searches: MockModule = (ctx, { method, path, rawBody }) => {
  const list = ctx.state.v2.savedSearches;
  if (path === '/api/saved-searches') {
    if (method === 'GET') return ok([...list].sort((a, b) => a.position - b.position || a.id - b.id));
    if (method !== 'POST') return null;
    const parsed = savedSearchInputSchema.safeParse(rawBody ?? {});
    if (!parsed.success) return fail(400, 'Please give the search a name of 1 to 60 characters.');
    if (list.length >= MAX_SAVED_SEARCHES) {
      return fail(409, `You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Delete one you no longer use, then save this one.`);
    }
    const { name, filter } = parsed.data;
    if (list.some((s) => sameName(s.name, name))) return taken(name);
    const saved: SavedSearch = { id: ctx.newId(), name, filter, position: Math.max(-1, ...list.map((s) => s.position)) + 1, createdAt: new Date().toISOString() };
    list.push(saved);
    return ok(saved);
  }
  const r = match(path, /^\/api\/saved-searches\/(\d+)$/);
  if (!r) return null;
  const i = list.findIndex((s) => s.id === Number(r[1]));
  if (method === 'DELETE') {
    if (i < 0) return gone();
    list.splice(i, 1);
    return ok({ ok: true });
  }
  if (method !== 'PATCH') return null;
  if (i < 0) return gone();
  const parsed = savedSearchPatchSchema.safeParse(rawBody ?? {});
  if (!parsed.success) return fail(400, 'Please give the search a name of 1 to 60 characters.');
  const patch = parsed.data;
  if (patch.name !== undefined && list.some((s, j) => j !== i && sameName(s.name, patch.name!))) return taken(patch.name);
  const current = list[i]!;
  list[i] = { ...current, name: patch.name ?? current.name, filter: patch.filter ?? current.filter, position: patch.position ?? current.position };
  return ok(list[i]);
};
