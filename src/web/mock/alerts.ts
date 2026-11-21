import { match, notBuilt, type MockModule } from './context.js';

/** Watching a bid: mute switch and "changes seen" (UX-7, MAT-15). Answers like the server stubs until then. */
export const alerts: MockModule = (_ctx, { method, path }) => {
  if (method !== 'POST') return null;
  if (match(path, /^\/api\/opportunities\/\d+\/alerts$/)) return notBuilt();
  if (match(path, /^\/api\/opportunities\/\d+\/changes\/seen$/)) return notBuilt();
  return null;
};
