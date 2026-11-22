import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SUBMISSION_METHOD_LABELS, SUBMISSION_METHODS, type Opportunity, type SubmissionMethod } from '../../shared/schemas.js';
import { addManualOpportunity, pasteAlert } from '../api.js';
import { useAction } from '../hooks.js';
import { Dialog } from './Dialog.js';
import { Field, Live } from './ui.js';
import { useToast } from './Toast.js';

export interface ManualAddDialogProps {
  /** Called with the new bid after it was added (by hand or from a pasted alert). */
  onAdded: (opportunity: Opportunity | null) => void;
}

type Mode = 'closed' | 'manual' | 'paste';

/**
 * "Add a bid by hand" and "Paste an alert": two buttons and their dialogs, for
 * bids seen on a portal that sent no alert, or alerts that cannot be saved as
 * an .eml file (Outlook). Lgbids never opens the links given here.
 */
export function ManualAddDialog({ onAdded }: ManualAddDialogProps) {
  const [mode, setMode] = useState<Mode>('closed');
  const close = () => setMode('closed');
  return (
    <>
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={() => setMode('manual')}>
          Add a bid by hand
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setMode('paste')}>
          Paste an alert
        </button>
      </div>
      <ManualForm open={mode === 'manual'} onClose={close} onAdded={onAdded} />
      <PasteForm open={mode === 'paste'} onClose={close} onAdded={onAdded} />
    </>
  );
}

function ManualForm({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (o: Opportunity | null) => void }) {
  const [title, setTitle] = useState('');
  const [buyer, setBuyer] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [link, setLink] = useState('');
  const [method, setMethod] = useState<SubmissionMethod>('unknown');
  const [text, setText] = useState('');
  const action = useAction();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBuyer('');
    setDate('');
    setTime('');
    setLink('');
    setMethod('unknown');
    setText('');
    action.clear();
  }, [open]);

  async function submit() {
    const closing = date ? (time ? `${date}T${time}` : date) : null;
    const opp = await action.run(() => addManualOpportunity({ title: title.trim(), buyer: buyer.trim(), closing, link: link.trim(), submissionMethod: method, text }));
    if (!opp) return;
    onAdded(opp);
    onClose();
    toast({ ok: true, text: `“${opp.title}” was added and scored.` });
    navigate(`/opportunities/${opp.id}`);
  }

  const ready = title.trim().length >= 3 && buyer.trim().length >= 2;
  return (
    <Dialog
      open={open}
      title="Add a bid by hand"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={action.busy || !ready}>
            {action.busy ? 'Adding…' : 'Add the bid'}
          </button>
        </>
      }
    >
      <p>For a bid you saw on a portal or in the paper. Lgbids scores it like any other bid and prepares a submission when it suits you.</p>
      <Field label="Title">
        <input type="text" value={title} required maxLength={300} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Buyer" hint="The organization asking for bids, for example District of Saanich.">
        <input type="text" value={buyer} required maxLength={200} onChange={(e) => setBuyer(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="Closing date" optional hint="Left blank, it is read from the notice text.">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Closing time" optional hint="Without a time, the bid closes at the end of that day.">
          <input type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Link to the notice" optional hint="Kept for you to open. Lgbids never opens it.">
        <input type="url" value={link} maxLength={1000} placeholder="https://" onChange={(e) => setLink(e.target.value)} />
      </Field>
      <Field label="How bids are submitted">
        <select value={method} onChange={(e) => setMethod(e.target.value as SubmissionMethod)}>
          {SUBMISSION_METHODS.map((m) => (
            <option key={m} value={m}>
              {m === 'unknown' ? 'Not sure (read it from the notice text)' : SUBMISSION_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notice text" optional hint="Paste the notice here. The closing date, reference number, submission address and requirements are read from it.">
        <textarea rows={6} value={text} maxLength={50_000} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Live message={action.message} />
    </Dialog>
  );
}

function PasteForm({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (o: Opportunity | null) => void }) {
  const [sender, setSender] = useState('');
  const [text, setText] = useState('');
  const action = useAction();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setSender('');
    setText('');
    action.clear();
  }, [open]);

  async function submit() {
    const result = await action.run(() => pasteAlert({ sender: sender.trim(), text, html: '' }));
    if (!result) return;
    if (!result.recognised) {
      action.setMessage({ ok: false, text: result.message });
      return;
    }
    onAdded(null);
    onClose();
    toast({ ok: true, text: result.message });
  }

  return (
    <Dialog
      open={open}
      title="Paste an alert"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={action.busy || text.trim() === ''}>
            {action.busy ? 'Reading…' : 'Read the alert'}
          </button>
        </>
      }
    >
      <p>Copy a BC Bid, Bonfire, CanadaBuys, bids&amp;tenders, MERX or Biddingo alert e-mail and paste it here. Lgbids reads the notices in it and never opens its links.</p>
      <Field label="Sent from" optional hint="The address the alert came from, for example noreply@bcbid.gov.bc.ca. Left blank, it is read from a “From:” line in the pasted e-mail.">
        <input type="text" value={sender} maxLength={200} onChange={(e) => setSender(e.target.value)} />
      </Field>
      <Field label="Alert e-mail">
        <textarea rows={8} value={text} required onChange={(e) => setText(e.target.value)} />
      </Field>
      <Live message={action.message} />
    </Dialog>
  );
}
