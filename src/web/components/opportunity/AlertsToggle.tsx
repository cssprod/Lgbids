import type { Opportunity } from '../../../shared/schemas.js';

export interface AlertsToggleProps {
  opportunity: Opportunity;
  /** Called with the saved opportunity after the switch changes. */
  onChange: (updated: Opportunity) => void;
}

/** "Remind me before it closes and tell me about changes" switch for one bid. Stub from the v2 foundation (UX-6b): renders nothing until UX-7 lands. */
export function AlertsToggle(_props: AlertsToggleProps) {
  return null;
}
