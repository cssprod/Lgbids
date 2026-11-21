import type { Opportunity } from '../../../shared/schemas.js';

export interface FeedbackButtonsProps {
  /** A detail response, which carries `myFeedback`. */
  opportunity: Opportunity;
  onChange: (updated: Opportunity) => void;
}

/** "Is this score right?" with Not relevant and Missed this one. Stub from the v2 foundation (UX-6b): renders nothing until UX-9 lands. */
export function FeedbackButtons(_props: FeedbackButtonsProps) {
  return null;
}
