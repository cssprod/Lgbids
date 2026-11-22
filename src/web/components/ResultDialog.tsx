import { useState } from 'react';
import { api, errorMessage, saveAward } from '../api.js';
import type { Application, Award } from '../../shared/schemas.js';
import { formatMoney } from '../format.js';
import { Dialog } from './Dialog.js';
import { Field, NumberInput } from './ui.js';

/**
 * The won / not-awarded hint the server adds to an application read from an
 * award notice. Not in the shared Application type yet (contract request), so
 * it is named here and read only where the server sends it.
 */
export interface ResultSuggestion {
  outcome: 'won' | 'lost';
  winner: string;
  message: string;
}
export type ApplicationWithResult = Application & { resultSuggestion?: ResultSuggestion | null };

export interface ResultDialogProps {
  open: boolean;
  outcome: 'won' | 'lost';
  application: Application;
  /** Your company's name, filled in as the winner on "Won". */
  companyName: string;
  /** What an award notice said, to start from. */
  suggestion?: Award | null;
  onClose: () => void;
  /** Called once the result (and the winner, if given) is saved. */
  onSaved: (message: string) => void;
}

/** "Won" or "Not awarded": records the result, then who won and at what price. */
export function ResultDialog({ open, outcome, application, companyName, suggestion, onClose, onSaved }: ResultDialogProps) {
  const fromNotice = suggestion && suggestion.status === 'suggested' ? suggestion : null;
  const [winner, setWinner] = useState(outcome === 'won' ? companyName || fromNotice?.winner || '' : fromNotice?.winner ?? '');
  const [amount, setAmount] = useState<number | null>(outcome === 'won' ? (fromNotice?.amount ?? application.priceTotal) : (fromNotice?.amount ?? null));
  const [awardedOn, setAwardedOn] = useState(fromNotice?.awardedOn ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = `result-${application.id}`;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (application.status !== outcome) await api.post<Application>(`/api/applications/${application.id}/status`, { status: outcome });
      if (winner.trim()) {
        await saveAward(application.opportunityId, { winner: winner.trim(), amount, awardedOn: awardedOn || null, notes: '' });
      }
      onSaved(outcome === 'won' ? 'Recorded as won. Congratulations.' : 'Recorded as not awarded.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={outcome === 'won' ? 'Record a win' : 'Record as not awarded'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save result'}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {fromNotice ? (
          <p className="small">
            Suggested from the award notice: {fromNotice.winner}
            {fromNotice.amount !== null ? `, ${formatMoney(fromNotice.amount)}` : ''}. Check it before you save.
          </p>
        ) : null}
        <Field label="Who won?" optional hint="Leave it empty if you do not know yet; you can add it later.">
          <input type="text" value={winner} maxLength={200} autoComplete="organization" onChange={(e) => setWinner(e.target.value)} />
        </Field>
        <Field label="Winning price" optional hint={application.priceTotal !== null ? `Your price was ${formatMoney(application.priceTotal)}.` : 'You did not enter a price for this bid.'}>
          <NumberInput value={amount} min={0} step="any" onChange={setAmount} />
        </Field>
        <Field label="Awarded on" optional>
          <input type="date" value={awardedOn} onChange={(e) => setAwardedOn(e.target.value)} />
        </Field>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
