import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Opportunity } from '../../../shared/schemas.js';
import { errorMessage, markChangesSeen } from '../../api.js';
import { useFormat, useResource } from '../../hooks.js';
import { useToast } from '../Toast.js';
import { Callout } from '../ui.js';
import { bannerSentence } from './ChangesSection.js';

export interface ChangeBannerProps {
  opportunity: Opportunity;
  /** Called after "Got it" marks the changes as seen. */
  onSeen: (updated: Opportunity) => void;
}

/** Application header banner, e.g. "The closing date moved from {a} to {b} (noticed {date})." (MAT-15). */
export function ChangeBanner({ opportunity, onSeen }: ChangeBannerProps) {
  const f = useFormat();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const unseen = opportunity.unseenChanges > 0 && !hidden;
  // The application carries a short opportunity; the changes come with its detail answer.
  const res = useResource<Opportunity>(unseen && !opportunity.changes ? `/api/opportunities/${opportunity.id}` : null);
  if (!unseen) return null;
  const changes = (opportunity.changes ?? res.data?.changes ?? []).filter((c) => c.seenAt === null && c.kind !== 'closing_refined');
  if (changes.length === 0) return null;
  const [latest, ...older] = changes;

  async function gotIt() {
    setBusy(true);
    try {
      const updated = await markChangesSeen(opportunity.id);
      setHidden(true);
      onSeen(updated);
    } catch (e) {
      toast({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Callout tone="warn" title="The buyer changed this bid">
      <p>{bannerSentence(latest!, f, opportunity.closesAtPrecision === 'date')}</p>
      {older.length > 0 ? (
        <p className="small">
          There {older.length === 1 ? 'is 1 more change' : `are ${older.length} more changes`}.{' '}
          <Link to={`/opportunities/${opportunity.id}`}>See what changed</Link>
        </p>
      ) : null}
      <p className="small muted">Check that your submission still fits, then mark the change as seen.</p>
      <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void gotIt()}>
        Got it
      </button>
    </Callout>
  );
}
