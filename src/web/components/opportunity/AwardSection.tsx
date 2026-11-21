import type { Application, Opportunity } from '../../../shared/schemas.js';

export interface AwardSectionProps {
  /** A detail response, which carries `award`. */
  opportunity: Opportunity;
  /** The application, when there is one, to compare prices. */
  application?: Application | null;
  onChange: () => void;
}

/** Who won and at what price, with Confirm / Edit / Ignore for a suggestion. Stub from the v2 foundation (UX-6b): renders nothing until UX-11 lands. */
export function AwardSection(_props: AwardSectionProps) {
  return null;
}
