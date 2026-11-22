import type { Opportunity } from '../../../shared/schemas.js';
import { Chip } from '../ui.js';

export interface ChangedChipProps {
  opportunity: Pick<Opportunity, 'lastChangedAt' | 'unseenChanges'>;
  /** The user's previous visit; the chip shows when the last change is newer. */
  since: string | null;
}

/** True when the bid changed after the user's last visit and the change is not marked as seen. */
export function changedSince(opportunity: Pick<Opportunity, 'lastChangedAt' | 'unseenChanges'>, since: string | null): boolean {
  if (!opportunity.lastChangedAt || opportunity.unseenChanges === 0) return false;
  // On a first visit there is no "last visit", so any unseen change counts.
  return since === null || opportunity.lastChangedAt > since;
}

/** "Changed" chip in lists (MAT-15). */
export function ChangedChip({ opportunity, since }: ChangedChipProps) {
  if (!changedSince(opportunity, since)) return null;
  return (
    <Chip tone="warn" symbol="↻" title="The buyer changed this notice since your last visit. Open it to see what changed.">
      Changed
    </Chip>
  );
}
