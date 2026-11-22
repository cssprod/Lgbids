import { useState } from 'react';
import type { Opportunity } from '../../../shared/schemas.js';
import { errorMessage, setAlertsMuted } from '../../api.js';
import { useToast } from '../Toast.js';
import { Check } from '../ui.js';

export interface AlertsToggleProps {
  opportunity: Opportunity;
  /** Called with the saved opportunity after the switch changes. */
  onChange: (updated: Opportunity) => void;
}

/** "Remind me before it closes and tell me about changes" switch for one bid (UX-7). */
export function AlertsToggle({ opportunity, onChange }: AlertsToggleProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Only open bids get reminders or change alerts, so a closed one shows nothing.
  if (opportunity.status !== 'open') return null;

  async function save(muted: boolean, undo: boolean) {
    setBusy(true);
    try {
      const updated = await setAlertsMuted(opportunity.id, muted);
      onChange(updated);
      if (undo) return;
      toast({
        text: muted ? 'Reminders and change alerts are off for this bid.' : 'Reminders and change alerts are on for this bid.',
        actions: [{ label: 'Undo', run: () => void save(!muted, true) }],
      });
    } catch (e) {
      toast({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Check
      className="alerts-toggle"
      label="Remind me before it closes and tell me about changes"
      hint="72 h and 24 h before closing, and when the buyer moves the date, adds an addendum, cancels or awards it. Sent by phone alert and e-mail, as set up in Settings."
      checked={!opportunity.alertsMuted}
      disabled={busy}
      onChange={(on) => void save(!on, false)}
    />
  );
}
