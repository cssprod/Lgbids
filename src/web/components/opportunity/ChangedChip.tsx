import type { Opportunity } from '../../../shared/schemas.js';

export interface ChangedChipProps {
  opportunity: Pick<Opportunity, 'lastChangedAt' | 'unseenChanges'>;
  /** The user's previous visit; the chip shows when the last change is newer. */
  since: string | null;
}

/** "Changed" chip in lists. Stub from the v2 foundation (UX-6b): renders nothing until MAT-15 lands. */
export function ChangedChip(_props: ChangedChipProps) {
  return null;
}
