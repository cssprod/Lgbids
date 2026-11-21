import type { Opportunity } from '../../shared/schemas.js';

export interface ManualAddDialogProps {
  /** Called with the new bid after it was added (by hand or from a pasted alert). */
  onAdded: (opportunity: Opportunity | null) => void;
}

/** "Add a bid by hand" and "Paste an alert": its own button and dialog. Stub from the v2 foundation (UX-6b): renders nothing until COV-15 lands. */
export function ManualAddDialog(_props: ManualAddDialogProps) {
  return null;
}
