import type { SourceStatus } from '../../shared/schemas.js';

/**
 * "Layout may have changed": a site that listed notices on its last
 * successful check and now lists none, without any error, has most often
 * been redesigned so the reader no longer finds the rows. Pure; the store
 * keeps the result.
 */

export interface LayoutHealthBefore {
  /** Notices listed on the last successful check (ok or empty), if any. */
  okItemCount: number | null;
  /** The warning currently shown, or ''. */
  warning: string;
}

export interface LayoutHealthResult {
  status: SourceStatus;
  itemCount: number | null;
  /** The site answered "not modified", so nothing was re-read. */
  unchanged?: boolean;
  /** The source lists only what is new since last time (the alert inbox). */
  incremental?: boolean;
}

export interface LayoutHealthAfter {
  warning: string;
  /** True only on the check that raised it, so the digest mentions it once. */
  raised: boolean;
}

export function layoutWarningText(previousCount: number): string {
  const had = previousCount === 1 ? '1 notice' : `${previousCount} notices`;
  return `This site returned no notices this time but listed ${had} last time — its layout may have changed. Open it and check, then press “Test”. If the buyer simply has nothing open, this warning clears once the site lists notices again.`;
}

export function nextLayoutHealth(before: LayoutHealthBefore, result: LayoutHealthResult): LayoutHealthAfter {
  // An empty run of a source that only returns what is new (no new alert
  // e-mails) is normal, so the layout rule never applies to it.
  if (result.incremental) return { warning: '', raised: false };
  const keep = { warning: before.warning, raised: false };
  // Errors and blocks have their own message; "not modified" proves nothing either way.
  if (result.unchanged || (result.status !== 'ok' && result.status !== 'empty')) return keep;
  if ((result.itemCount ?? 0) > 0) return { warning: '', raised: false };
  // Still empty after an earlier warning: keep it until notices come back.
  if (before.warning) return keep;
  if ((before.okItemCount ?? 0) > 0) return { warning: layoutWarningText(before.okItemCount!), raised: true };
  return keep;
}
