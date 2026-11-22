import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Dialog } from './Dialog.js';
import { Field } from './ui.js';
import { useToast } from './Toast.js';

/**
 * Shown only in the hosted prototype (VITE_PROTOTYPE=1): says the data is
 * invented, lists what to try, collects feedback through Netlify Forms and
 * lets a tester start again from the sample data.
 */

/** Name of the form Netlify detects at deploy time (see scripts/prototype.mjs). */
const FORM_NAME = 'beta-feedback';

const TASKS: { title: string; detail: string }[] = [
  { title: 'Start from Today', detail: 'Can you tell within a few seconds what needs you and what closes soon?' },
  { title: 'Decide on a bid', detail: 'Open Opportunities. Mark one bid “Pursue” and one “Not for us”. Were the score and reasons convincing?' },
  { title: 'Finish an application', detail: 'Open the boulevard maintenance application: enter a price, tick the checklist, sort out whatever it says is still needed, preview the package PDF, then send it.' },
  { title: 'Portal bid', detail: 'Open the sports field application (BC Bid). Download the package and mark it as submitted.' },
  { title: 'Find new bids', detail: 'Press “Run now” on Today and wait a few seconds. Did you notice the new bid?' },
  { title: 'Set up your company', detail: 'Fill in the company profile and upload a document. Was anything unclear or missing?' },
  { title: 'Alert inbox', detail: 'Settings → Bid alert inbox: follow the Gmail steps and press “Test connection” (nothing is really connected here).' },
  { title: 'Phone alerts', detail: 'Settings → Phone alerts: choose ntfy, then press “Send test alert”. Was it clear what to do on the phone?' },
  { title: 'Spreadsheet', detail: 'On Opportunities, filter the list, then press “Download CSV”. Does the file open and hold what you expected?' },
  { title: 'On your phone', detail: 'Try any of the above on a phone. Note anything hard to tap or read.' },
];

function encode(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function PrototypeBar() {
  const [tasksOpen, setTasksOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <div className="prototype-bar" role="note">
      <p>
        <strong>Beta prototype.</strong> Invented sample bids; nothing is sent to anyone. Your changes stay in this browser only.
      </p>
      <div className="prototype-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setTasksOpen(true)}>
          What to try
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setFeedbackOpen(true)}>
          Send feedback
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setResetOpen(true)}>
          Start over
        </button>
      </div>

      <Dialog
        open={tasksOpen}
        title="What to try"
        onClose={() => setTasksOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setTasksOpen(false)}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setTasksOpen(false);
                setFeedbackOpen(true);
              }}
            >
              Send feedback
            </button>
          </>
        }
      >
        <p className="muted">Lgbids finds landscaping bids in Greater Victoria, scores them and prepares your submission. A few tasks to walk through:</p>
        <ol className="prototype-tasks">
          {TASKS.map((t) => (
            <li key={t.title}>
              <strong>{t.title}.</strong> {t.detail}
            </li>
          ))}
        </ol>
      </Dialog>

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      <Dialog
        open={resetOpen}
        title="Start over?"
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setResetOpen(false)}>
              Keep my changes
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                const { resetPrototype } = await import('../mock.js');
                resetPrototype();
                location.assign('/');
              }}
            >
              Start over
            </button>
          </>
        }
      >
        <p>This puts back the original sample bids and applications and forgets everything you changed in this browser.</p>
      </Dialog>
    </div>
  );
}

function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const location = useLocation();
  const [kind, setKind] = useState('Something is confusing');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      setError('Write a sentence or two about what you noticed.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/feedback.html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encode({
          'form-name': FORM_NAME,
          kind,
          message: message.trim(),
          name: name.trim(),
          page: location.pathname,
          screen: `${window.innerWidth}×${window.innerHeight}`,
          browser: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMessage('');
      onClose();
      toast({ text: 'Thank you. Your feedback was sent.', ok: true });
    } catch {
      setError('The feedback could not be sent from here. Please e-mail it to the person who invited you instead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Send feedback"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="feedback-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send feedback'}
          </button>
        </>
      }
    >
      <form id="feedback-form" className="stack" onSubmit={submit} noValidate>
        <Field label="What kind of feedback?">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option>Something is confusing</option>
            <option>Something is broken</option>
            <option>Something is missing</option>
            <option>Something is not needed</option>
            <option>Idea or praise</option>
          </select>
        </Field>
        <Field label="What happened?" hint={`We also note the page you are on (${location.pathname}) and your screen size.`} error={error || undefined}>
          <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <Field label="Your name or company" optional>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
        </Field>
      </form>
    </Dialog>
  );
}
