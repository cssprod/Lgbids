import { notBuilt, type MockModule } from './context.js';

/** Bids added by hand and pasted alerts (COV-15). Answers like the server stubs until then. */
export const manual: MockModule = (_ctx, { method, path }) => {
  if (method !== 'POST') return null;
  if (path === '/api/opportunities/manual' || path === '/api/opportunities/paste-alert') return notBuilt();
  return null;
};
