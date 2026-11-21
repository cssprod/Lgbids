import type { FeedbackRecord, FeedbackVerdict, Opportunity } from '../../shared/schemas.js';

export interface FeedbackDialogProps {
  open: boolean;
  opportunity: Opportunity;
  verdict: FeedbackVerdict;
  onClose: () => void;
  onSaved: (feedback: FeedbackRecord) => void;
}

/** Reason radios and an optional note for one bid. Stub from the v2 foundation (UX-6b): renders nothing until UX-9 lands. */
export function FeedbackDialog(_props: FeedbackDialogProps) {
  return null;
}
