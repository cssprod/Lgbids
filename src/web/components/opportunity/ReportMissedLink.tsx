import { useState, type FormEvent } from 'react';
import { errorMessage, reportMissedBid } from '../../api.js';
import { Dialog } from '../Dialog.js';
import { postNoticeFeedback } from '../FeedbackDialog.js';
import { Field } from '../ui.js';
import { useToast } from '../Toast.js';
import { FEEDBACK_THANKS } from './FeedbackButtons.js';

export interface ReportMissedLinkProps {
  className?: string;
}

const EMPTY = { title: '', url: '', organization: '', foundVia: '', note: '', text: '' };

/** "Report a bid Lgbids missed" link and its dialog. The report is feedback only, never a source (D19). */
export function ReportMissedLink({ className }: ReportMissedLinkProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.title.trim().length < 3) {
      setError('Give the bid’s title, at least three letters long.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const input = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as typeof EMPTY;
      await reportMissedBid(input);
      postNoticeFeedback({ id: null, title: input.title, url: input.url }, 'missed', [], input.note);
      setOpen(false);
      setForm(EMPTY);
      toast({ text: FEEDBACK_THANKS });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className ?? 'report-missed'}>
      <p className="muted small">
        Saw a bid somewhere that Lgbids did not show you?{' '}
        <button type="button" className="btn btn-small btn-ghost" onClick={() => setOpen(true)}>
          Report a bid Lgbids missed
        </button>
      </p>
      <Dialog
        open={open}
        title="Report a bid Lgbids missed"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="report-missed-form" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
          </>
        }
      >
        <form id="report-missed-form" onSubmit={submit} noValidate>
          <p className="muted small">This helps tune the scoring. It does not add the bid to your lists.</p>
          <Field label="Bid title" error={error || undefined}>
            <input type="text" maxLength={300} required value={form.title} onChange={set('title')} />
          </Field>
          <Field label="Buyer" optional>
            <input type="text" maxLength={200} value={form.organization} onChange={set('organization')} />
          </Field>
          <Field label="Link to the notice" optional>
            <input type="url" maxLength={1000} value={form.url} onChange={set('url')} />
          </Field>
          <Field label="Where you saw it" optional hint="For example BC Bid, a newsletter or a phone call.">
            <input type="text" maxLength={200} value={form.foundVia} onChange={set('foundVia')} />
          </Field>
          <Field label="Notice text" optional hint="Paste the description if you have it; it is used only to check the score.">
            <textarea rows={4} maxLength={50000} value={form.text} onChange={set('text')} />
          </Field>
          <Field label="Anything else?" optional>
            <textarea rows={2} maxLength={1000} value={form.note} onChange={set('note')} />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
