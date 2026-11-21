import type { Opportunity } from '../../../shared/schemas.js';

export interface ChangeBannerProps {
  opportunity: Opportunity;
  /** Called after "Got it" marks the changes as seen. */
  onSeen: (updated: Opportunity) => void;
}

/** Application header banner, e.g. "The closing date moved from {a} to {b}". Stub from the v2 foundation (UX-6b): renders nothing until MAT-15 lands. */
export function ChangeBanner(_props: ChangeBannerProps) {
  return null;
}
