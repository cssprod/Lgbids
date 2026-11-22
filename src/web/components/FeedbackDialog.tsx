import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, saveFeedback } from '../api.js';
import { FEEDBACK_REASON_LABELS, type FeedbackReason, type FeedbackRecord, type FeedbackVerdict, type Opportunity } from '../../shared/schemas.js';
import { Dialog } from './Dialog.js';
import { Field } from './ui.js';

export interface FeedbackDialogProps {
  open: boolean;
  opportunity: Opportunity;
  verdict: FeedbackVerdict;
  onClose: () => void;
  onSaved: (feedback: FeedbackRecord) => void;
}

/** The reasons that fit each verdict, in the order they are offered. */
export const REASONS_FOR: Record<FeedbackVerdict, FeedbackReason[]> = {
  not_relevant: ['not_our_work', 'supply_only', 'outside_area', 'too_big_small', 'duplicate', 'other'],
  missed: ['our_work', 'in_area', 'other'],
};

const TITLES: Record<FeedbackVerdict, string> = {
  not_relevant: 'Why is this bid not relevant?',
  missed: 'Why should Lgbids have shown this bid?',
};

/**
 * The beta prototype also sends each item to the Netlify form
 * `notice-feedback` (D22). The check on import.meta.env is written inline so
 * the build drops this code from the real app.
 */
export function postNoticeFeedback(item: { id: number | null; title: string; url: string }, verdict: FeedbackVerdict, reasons: string[], note: string): void {
  if (import.meta.env.VITE_PROTOTYPE) {
    const body = new URLSearchParams({ 'form-name': 'notice-feedback', verdict, reasons: reasons.join(', '), note, title: item.title, url: item.url, opportunity: item.id === null ? '' : String(item.id) });
    // Best effort: the feedback is already saved in the prototype, so a failed post is not shown.
    void fetch('/feedback.html', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }).catch(() => {});
  }
}

/** Reason radios and an optional note for one bid. The native dialog keeps focus inside and Esc closes it. */
export function FeedbackDialog({ open, opportunity, verdict, onClose, onSaved }: FeedbackDialogProps) {
  const [reason, setReason] = useState<FeedbackReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const previous = opportunity.myFeedback?.verdict === verdict ? opportunity.myFeedback : null;
    setReason(previous?.reasons[0] ?? '');
    setNote(previous?.note ?? '');
    setError('');
  }, [open, verdict, opportunity.myFeedback]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const reasons = reason ? [reason] : [];
      const saved = await saveFeedback(opportunity.id, { verdict, reasons, note: note.trim() });
      postNoticeFeedback(opportunity, verdict, reasons, note.trim());
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const formId = `feedback-form-${opportunity.id}`;
  return (
    <Dialog
      open={open}
      title={TITLES[verdict]}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Send feedback'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <p className="muted small">“{opportunity.title}”. Your answer is used to tune the scoring rules; it does not change this score.</p>
        <fieldset className="radio-list">
          <legend>Reason (optional)</legend>
          {REASONS_FOR[verdict].map((r) => (
            <label key={r} className="radio">
              <input type="radio" name={`reason-${formId}`} value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span>{FEEDBACK_REASON_LABELS[r]}</span>
            </label>
          ))}
        </fieldset>
        <Field label="Anything else?" optional>
          <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
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
