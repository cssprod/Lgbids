import { match, notBuilt, type MockModule } from './context.js';

/** Saved searches (UX-13). Answers like the server stubs until then. */
export const searches: MockModule = (_ctx, { path }) => {
  if (path === '/api/saved-searches' || match(path, /^\/api\/saved-searches\/\d+$/)) return notBuilt();
  return null;
};
