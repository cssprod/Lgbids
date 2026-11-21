import type { Connector } from '../types.js';

/**
 * The "Added by hand" source: bids the user typed in or pasted from an alert
 * (POST /api/opportunities/manual and /paste-alert). They are saved directly,
 * so there is never anything to read, and nothing is ever fetched.
 */
export const manual: Connector = {
  kind: 'manual',
  // Only ever "what is new", so an empty run says nothing about the source working.
  incremental: true,
  async list(_source, ctx) {
    ctx.note('Bids you add by hand are kept here, so there is nothing to read.');
    return { items: [] };
  },
};
