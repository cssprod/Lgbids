import type { Opportunity } from '../../../shared/schemas.js';

export interface ChangesSectionProps {
  /** A detail response, which carries `changes`. */
  opportunity: Opportunity;
  onChange: (updated: Opportunity) => void;
}

/** "What changed" timeline on the bid page, newest first. Stub from the v2 foundation (UX-6b): renders nothing until MAT-15 lands. */
export function ChangesSection(_props: ChangesSectionProps) {
  return null;
}
