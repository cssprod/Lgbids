import { useState } from 'react';
import { api, deleteFeedback, errorMessage } from '../../api.js';
import { FEEDBACK_REASON_LABELS, type FeedbackVerdict, type Opportunity } from '../../../shared/schemas.js';
import { FeedbackDialog } from '../FeedbackDialog.js';
import { useToast } from '../Toast.js';

export interface FeedbackButtonsProps {
  /** A detail response, which carries `myFeedback`. */
  opportunity: Opportunity;
  onChange: (updated: Opportunity) => void;
}

export const FEEDBACK_THANKS = 'Thanks — this helps tune the scoring.';

/** "Is this score right?" with Not relevant and Missed this one. Feedback never changes the score directly. */
export function FeedbackButtons({ opportunity: o, onChange }: FeedbackButtonsProps) {
  const toast = useToast();
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = o.myFeedback ?? null;

  const reload = async () => onChange(await api.get<Opportunity>(`/api/opportunities/${o.id}`));

  async function undo() {
    setBusy(true);
    try {
      await deleteFeedback(o.id);
      await reload();
      toast({ text: 'Your feedback was removed.' });
    } catch (e) {
      toast({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="feedback-box">
      {mine ? (
        <>
          <p className="small" role="status">
            <strong>{FEEDBACK_THANKS}</strong> You said this bid is {mine.verdict === 'not_relevant' ? 'not relevant' : 'one Lgbids should have shown'}
            {mine.reasons.length ? ` (${mine.reasons.map((r) => FEEDBACK_REASON_LABELS[r].toLowerCase()).join(', ')})` : ''}.
          </p>
          <p>
            <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => setVerdict(mine.verdict)}>
              Change my answer
            </button>
            <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={undo}>
              Remove my feedback
            </button>
          </p>
        </>
      ) : (
        <p className="small">
          <span>Is this score right? </span>
          <button type="button" className="btn btn-small btn-secondary" onClick={() => setVerdict('not_relevant')}>
            Not relevant
          </button>{' '}
          <button type="button" className="btn btn-small btn-secondary" onClick={() => setVerdict('missed')}>
            Missed this one
          </button>
        </p>
      )}
      <FeedbackDialog
        open={verdict !== null}
        opportunity={o}
        verdict={verdict ?? 'not_relevant'}
        onClose={() => setVerdict(null)}
        onSaved={async () => {
          setVerdict(null);
          toast({ text: FEEDBACK_THANKS });
          try {
            await reload();
          } catch (e) {
            toast({ ok: false, text: errorMessage(e) });
          }
        }}
      />
    </div>
  );
}
