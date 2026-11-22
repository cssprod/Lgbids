import { useEffect, useState } from 'react';
import { api, deleteAward, errorMessage, saveAward } from '../../api.js';
import type { Application, Award, Opportunity } from '../../../shared/schemas.js';
import { useAction } from '../../hooks.js';
import { formatMoney, formatPlainDate } from '../../format.js';
import { ConfirmDialog, Dialog } from '../Dialog.js';
import type { ApplicationWithResult } from '../ResultDialog.js';
import { Callout, Field, Live, NumberInput, Section } from '../ui.js';

export interface AwardSectionProps {
  /** A detail response, which carries `award`. */
  opportunity: Opportunity;
  /** The application, when there is one, to compare prices. */
  application?: Application | null;
  onChange: () => void;
}

/** "Your price was 4% higher than the winning price." Null when either price is missing. */
export function priceDifference(own: number | null | undefined, winning: number | null | undefined): string | null {
  if (own === null || own === undefined || winning === null || winning === undefined || winning <= 0) return null;
  const pct = Math.round(((own - winning) / winning) * 100);
  if (pct === 0) return 'Your price was about the same as the winning price.';
  return `Your price was ${Math.abs(pct)}% ${pct > 0 ? 'higher' : 'lower'} than the winning price.`;
}

/**
 * Who won and at what price (UX-11). A value read from an award notice is
 * only shown as a suggestion, with Confirm, Edit and Ignore; nothing counts
 * as the result until the person confirms it.
 */
export function AwardSection({ opportunity, application, onChange }: AwardSectionProps) {
  // Detail responses carry `award`; an application's copy of the bid may not, so fetch it then.
  const [award, setAward] = useState<Award | null | undefined>(opportunity.award);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const action = useAction();

  useEffect(() => {
    if (opportunity.award !== undefined) {
      setAward(opportunity.award);
      return;
    }
    let cancelled = false;
    api.get<Opportunity>(`/api/opportunities/${opportunity.id}`).then(
      (o) => {
        if (!cancelled) setAward(o.award ?? null);
      },
      () => {
        if (!cancelled) setAward(null);
      },
    );
    return () => {
      cancelled = true;
    };
    // A reload after a result was recorded (the application changes) fetches again.
  }, [opportunity, application?.status, application?.updatedAt]);

  const hasResult = application?.status === 'won' || application?.status === 'lost';
  if (award === undefined) return null;
  // Nothing to show on an open bid with no award yet.
  if (!award && opportunity.status === 'open' && !hasResult) return null;

  const own = application?.priceTotal ?? null;
  const hint = (application as ApplicationWithResult | null | undefined)?.resultSuggestion ?? null;

  async function confirm(a: Award) {
    const saved = await action.run(() => saveAward(opportunity.id, { winner: a.winner, amount: a.amount, awardedOn: a.awardedOn, notes: a.notes }), 'The result was confirmed.');
    if (saved) {
      setAward(saved);
      onChange();
    }
  }

  async function remove(message: string) {
    const done = await action.run(() => deleteAward(opportunity.id), message);
    if (done) {
      setAward(null);
      setConfirmRemove(false);
      onChange();
    }
  }

  const body = !award ? (
    <>
      <p className="muted">Who won this bid is not recorded yet.</p>
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
          Record who won
        </button>
      </div>
    </>
  ) : award.status === 'suggested' ? (
    <>
      <Callout tone="info" title="Not confirmed yet">
        <p>
          Suggested from the award notice: <strong>{award.winner || 'winner not stated'}</strong>
          {award.amount !== null ? <>, {formatMoney(award.amount)}</> : null}.
        </p>
        {award.excerpt ? <p className="muted small">“{award.excerpt}”</p> : null}
        {hint && application?.status === 'submitted' ? (
          <p className="small">
            {hint.outcome === 'won'
              ? 'The winner matches your company name, so this looks like a win. Record it with “Won” above.'
              : 'The winner does not match your company name, so this bid was probably not won. Record it with “Not awarded” above.'}
          </p>
        ) : null}
        <p className="small">Lgbids read this from the notice. It is not counted as the result until you confirm it.</p>
      </Callout>
      <div className="button-row">
        <button type="button" className="btn btn-primary" disabled={action.busy || !award.winner} onClick={() => confirm(award)}>
          Confirm
        </button>
        <button type="button" className="btn btn-secondary" disabled={action.busy} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="btn btn-ghost" disabled={action.busy} onClick={() => remove('The suggestion was ignored.')}>
          Ignore
        </button>
      </div>
    </>
  ) : (
    <>
      <dl className="facts">
        <div>
          <dt>Winner</dt>
          <dd>{award.winner}</dd>
        </div>
        <div>
          <dt>Winning price</dt>
          <dd>{award.amount !== null ? formatMoney(award.amount) : 'Not known'}</dd>
        </div>
        {application ? (
          <div>
            <dt>Your price</dt>
            <dd>{own !== null ? formatMoney(own) : 'Not entered'}</dd>
          </div>
        ) : null}
        {award.awardedOn ? (
          <div>
            <dt>Awarded on</dt>
            <dd>{formatPlainDate(award.awardedOn)}</dd>
          </div>
        ) : null}
        {award.notes ? (
          <div>
            <dt>Notes</dt>
            <dd>{award.notes}</dd>
          </div>
        ) : null}
      </dl>
      {application ? <p className="small">{priceDifference(own, award.amount) ?? ''}</p> : null}
      <div className="button-row">
        <button type="button" className="btn btn-secondary" disabled={action.busy} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="btn btn-ghost" disabled={action.busy} onClick={() => setConfirmRemove(true)}>
          Remove
        </button>
      </div>
    </>
  );

  return (
    <Section title="Result">
      {body}
      <Live message={action.message} />
      {editing ? (
        <AwardForm
          opportunityId={opportunity.id}
          award={award ?? null}
          ownPrice={own}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setAward(saved);
            setEditing(false);
            action.setMessage({ ok: true, text: 'The result was saved.' });
            onChange();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove who won?"
        confirmLabel="Remove"
        danger
        busy={action.busy}
        onConfirm={() => remove('Who won was removed.')}
        onClose={() => setConfirmRemove(false)}
      >
        <p>The winner and winning price for this bid are removed. Your own result (won or not awarded) stays as it is.</p>
      </ConfirmDialog>
    </Section>
  );
}

function AwardForm({
  opportunityId,
  award,
  ownPrice,
  onClose,
  onSaved,
}: {
  opportunityId: number;
  award: Award | null;
  ownPrice: number | null;
  onClose: () => void;
  onSaved: (award: Award) => void;
}) {
  const [winner, setWinner] = useState(award?.winner ?? '');
  const [amount, setAmount] = useState<number | null>(award?.amount ?? null);
  const [awardedOn, setAwardedOn] = useState(award?.awardedOn ?? '');
  const [notes, setNotes] = useState(award?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = `award-${opportunityId}`;

  async function save() {
    if (!winner.trim()) {
      setError('Enter who won the bid.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveAward(opportunityId, { winner: winner.trim(), amount, awardedOn: awardedOn || null, notes: notes.trim() }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Who won?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
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
        <Field label="Who won?" error={error && !winner.trim() ? error : undefined}>
          <input type="text" value={winner} maxLength={200} autoComplete="organization" onChange={(e) => setWinner(e.target.value)} />
        </Field>
        <Field label="Winning price" optional hint={ownPrice !== null ? `Your price was ${formatMoney(ownPrice)}.` : undefined}>
          <NumberInput value={amount} min={0} step="any" onChange={setAmount} />
        </Field>
        <Field label="Awarded on" optional>
          <input type="date" value={awardedOn} onChange={(e) => setAwardedOn(e.target.value)} />
        </Field>
        <Field label="Notes" optional>
          <textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && winner.trim() ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
