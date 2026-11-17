/**
 * True only in the hosted beta prototype (scripts/prototype.mjs). Replaced at
 * build time, so the prototype-only code is left out of the real app's bundle.
 */
export const PROTOTYPE = import.meta.env.VITE_PROTOTYPE === '1';
