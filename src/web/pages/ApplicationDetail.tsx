import { useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { Application, ApplicationChannel, ApplicationStatus, ApplicationUpdate, LibraryDocument } from '../../shared/schemas.js';
import { DOCUMENT_KIND_LABELS, SUBMISSION_METHOD_LABELS } from '../../shared/schemas.js';
import { useAction, useDocumentTitle, useFormat, useResource, useUnsavedWarning } from '../hooks.js';
import { AwardSection } from '../components/opportunity/AwardSection.js';
import { ChangeBanner } from '../components/opportunity/ChangeBanner.js';
import { ApplicationChip } from '../components/status.js';
import { ConfirmDialog, Dialog } from '../components/Dialog.js';
import { BackLink, Callout, Check, ErrorBox, ExternalLink, Field, Live, Loading, NumberInput, PlainText, Section } from '../components/ui.js';
import { emailProblem, formatBytes, formatMoney } from '../format.js';
import { Icon } from '../components/Icon.js';

interface Draft {
  channel: ApplicationChannel;
  toEmail: string;
  ccEmail: string;
  subject: string;
  body: string;
  priceTotal: number | null;
  priceNotes: string;
  includeRates: boolean;
  notes: string;
}

function draftOf(a: Application): Draft {
  return {
    channel: a.channel,
    toEmail: a.toEmail,
    ccEmail: a.ccEmail,
    subject: a.subject,
    body: a.body,
    priceTotal: a.priceTotal,
    priceNotes: a.priceNotes,
    includeRates: a.includeRates,
    notes: a.notes,
  };
}

const LOCKED: ApplicationStatus[] = ['sending', 'submitted', 'won', 'lost', 'withdrawn', 'expired'];
const OUTCOME: ApplicationStatus[] = ['submitted', 'won', 'lost'];

const CHANNEL_OPTIONS: { value: ApplicationChannel; label: string; hint: string }[] = [
  { value: 'email', label: 'By e-mail', hint: 'Lgbids sends the letter and attachments to the buyer.' },
  { value: 'portal', label: 'On the buyer’s portal', hint: 'You download the package and upload it yourself.' },
  { value: 'manual', label: 'By hand or courier', hint: 'You print and deliver the package yourself.' },
];

export function ApplicationDetailPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const res = useResource<Application>(`/api/applications/${id ?? ''}`);
  const docs = useResource<LibraryDocument[]>('/api/documents');
  const save = useAction();
  const quick = useAction();
  const send = useAction();
  const upload = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileId = useId();

  const a = res.data;
  const o = a?.opportunity;
  useDocumentTitle(o?.title ?? 'Application');

  // The server copy the current draft was based on. When a new copy arrives (after
  // an autosave, a checklist tick or a reload), fields the user changed since that
  // base keep the user's value; untouched fields take the server's.
  const baseRef = useRef<Draft | null>(null);
  useEffect(() => {
    if (!a) return;
    const next = draftOf(a);
    const base = baseRef.current;
    baseRef.current = next;
    setDraft((prev) => {
      if (!prev || !base) return next;
      const merged = { ...next } as Record<keyof Draft, unknown>;
      for (const key of Object.keys(next) as (keyof Draft)[]) {
        if (JSON.stringify(prev[key]) !== JSON.stringify(base[key])) merged[key] = prev[key];
      }
      return merged as Draft;
    });
  }, [a]);

  const dirty = !!a && !!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(a));
  useUnsavedWarning(dirty);

  // Save the price, letter and notes on their own, 1.5 s after the last change.
  const editable = !!a && !LOCKED.includes(a.status);
  // A draft the server refused is not retried until it changes; its error stays on screen.
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const saveFailed = !!draft && failedDraft === JSON.stringify(draft);
  useEffect(() => {
    if (!dirty || !editable || save.busy || !a || !draft || saveFailed) return;
    const t = window.setTimeout(() => {
      const json = JSON.stringify(draft);
      void save.run(() => api.patch<Application>(`/api/applications/${a.id}`, draft)).then((updated) => {
        if (updated) {
          setFailedDraft(null);
          res.setData(updated);
        } else {
          setFailedDraft(json);
        }
      });
    }, 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, editable, save.busy, saveFailed]);
  useSendErrorSync(send.message, setSendError);

  if (res.loading && !a) return <Loading />;
  if (res.error && !a) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!a || !draft) return null;

  const locked = LOCKED.includes(a.status);
  const closing = o ? fmt.closing(o.closesAt, o.closesAtPrecision, o.closesAtRaw) : null;
  const libraryDocs = docs.data ?? [];
  const attachedDocs = libraryDocs.filter((d) => a.documentIds.includes(d.id));
  const portalUrl = o?.submissionUrl || o?.url || '';
  const packageUrl = `/api/applications/${a.id}/package.pdf`;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });

  async function patch(body: ApplicationUpdate, message: string, which = quick) {
    const updated = await which.run(() => api.patch<Application>(`/api/applications/${a!.id}`, body), message);
    if (updated) res.setData(updated);
    return updated;
  }

  async function saveDraft() {
    await patch(draft!, 'Saved.', save);
  }

  async function doSend() {
    setSendError(null);
    try {
      const updated = await send.run(() => api.post<Application>(`/api/applications/${a!.id}/send`), (r) =>
        r.status === 'submitted' ? `Sent to ${r.toEmail}.` : 'The submission was handed to your mail server.',
      );
      if (updated) res.setData(updated);
      else res.reload();
    } finally {
      setConfirmSend(false);
    }
  }

  async function setStatus(status: 'withdrawn' | 'won' | 'lost' | 'needs_input' | 'submitted', message: string) {
    const updated = await quick.run(() => api.post<Application>(`/api/applications/${a!.id}/status`, { status }), message);
    if (updated) res.setData(updated);
  }

  async function regenerate() {
    const updated = await quick.run(() => api.post<Application>(`/api/applications/${a!.id}/regenerate`), 'The letter was rebuilt from your company profile.');
    if (updated) res.setData(updated);
    setConfirmRegen(false);
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      const form = new FormData();
      form.append('file', f);
      const updated = await upload.run(() => api.upload<Application>(`/api/applications/${a!.id}/files`, form), `Added ${f.name}.`);
      if (updated) res.setData(updated);
      else break;
    }
  }

  async function removeFile(fileIdToRemove: number, name: string) {
    const updated = await upload.run(() => api.del<Application>(`/api/applications/${a!.id}/files/${fileIdToRemove}`), `Removed ${name}.`);
    if (updated) res.setData(updated);
  }

  const canSendEmail = a.channel === 'email' && (a.status === 'ready' || a.status === 'failed') && a.missing.length === 0;

  return (
    <>
      <BackLink to="/applications">All applications</BackLink>
      <header className="page-header detail-header">
        <div>
          <p className="eyebrow">Application</p>
          <h1>{o?.title ?? `Application ${a.id}`}</h1>
          <p className="lead">
            {o?.organization}
            {o?.referenceNumber ? <span className="muted"> · Reference {o.referenceNumber}</span> : null}
          </p>
          <p className="opp-tags">
            <ApplicationChip status={a.status} />
            {closing ? (
              <span className={closing.soon ? 'text-warn strong' : ''}>
                {closing.relative} · {closing.absolute}
              </span>
            ) : null}
          </p>
          {o ? (
            <p className="small inline-links">
              <Link to={`/opportunities/${o.id}`}>See the opportunity and its requirements</Link>
              {o.closesAt && !locked ? (
                <a href={`/api/calendar.ics?id=${o.id}`}>
                  <Icon name="calendar" size={14} /> Add the closing time to your calendar
                </a>
              ) : null}
            </p>
          ) : null}
        </div>
      </header>
      {o ? <ChangeBanner opportunity={o} onSeen={() => res.reload()} /> : null}

      {a.error || sendError ? (
        <div className="callout callout-bad" role="alert">
          <span className="callout-symbol" aria-hidden="true">
            ✕
          </span>
          <div>
            <p className="callout-title">{a.status === 'failed' ? 'Sending failed.' : 'The last attempt did not work.'}</p>
            <pre className="error-text">{sendError ?? a.error}</pre>
            <p className="small">Nothing more will be sent automatically. Fix the problem, then send it again.</p>
          </div>
        </div>
      ) : null}

      {a.status === 'sending' ? (
        <Callout tone="warn" title="This submission was being sent when Lgbids last stopped.">
          <p>
            Lgbids will not send it again by itself, so the buyer does not get it twice. Check your sent mail. If it went out, mark it as
            submitted; if not, send it again.
          </p>
        </Callout>
      ) : null}

      {!locked && a.missing.length > 0 ? (
        <section className="missing-box" aria-labelledby="missing-title">
          <h2 id="missing-title">
            <Icon name="alert" size={18} />
            Still needed before this can be submitted
          </h2>
          {a.checklist.length > 0 ? (
            <div className="progress-row">
              <div
                className="progress progress-warn"
                role="progressbar"
                aria-label="Checklist progress"
                aria-valuemin={0}
                aria-valuemax={a.checklist.length}
                aria-valuenow={a.checklist.filter((c) => c.done).length}
              >
                <span style={{ width: `${(a.checklist.filter((c) => c.done).length / a.checklist.length) * 100}%` }} />
              </div>
              <span className="small muted">
                {a.checklist.filter((c) => c.done).length} of {a.checklist.length} checklist items ticked
              </span>
            </div>
          ) : null}
          <ul>
            {a.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {a.checklist.some((c) => !c.done) ? (
            <p className="small missing-jump">
              <a href="#checklist">Go to the checklist</a>
            </p>
          ) : null}
        </section>
      ) : null}

      {!locked ? (
        <nav className="step-bar" aria-label="Steps to submit">
          {[
            { href: '#price-letter', label: 'Price and letter', done: !a.missing.some((m) => /total price/i.test(m)) },
            { href: '#checklist', label: 'Checklist and files', done: a.checklist.every((c) => c.done || !c.required) },
            { href: '#submit', label: a.channel === 'email' ? 'Send' : 'Submit', done: false },
          ].map((step, i) => (
            <a key={step.href} href={step.href} className={`step-link ${step.done ? 'done' : ''}`}>
              <span className="step-num" aria-hidden="true">
                {step.done ? <Icon name="check" size={14} /> : i + 1}
              </span>
              {step.label}
              {step.done ? <span className="visually-hidden"> (done)</span> : null}
            </a>
          ))}
        </nav>
      ) : null}

      {a.submittedAt || OUTCOME.includes(a.status) ? (
        <Section title="Submission">
          <p>
            {a.submittedAt ? (
              <>
                Submitted <strong>{fmt.dateTime(a.submittedAt)}</strong>
                {a.submittedVia ? <> via {a.submittedVia}</> : null}.
              </>
            ) : (
              'Submitted.'
            )}
            {a.submissionRef ? <> Confirmation number: <strong>{a.submissionRef}</strong>.</> : null}
          </p>
          {OUTCOME.includes(a.status) ? (
            <>
              <p className="muted small">When the buyer decides, record the result here.</p>
              <div className="button-row">
                <button type="button" className="btn btn-secondary" disabled={quick.busy || a.status === 'won'} onClick={() => setStatus('won', 'Recorded as won. Congratulations.')}>
                  <span aria-hidden="true">★ </span>Won
                </button>
                <button type="button" className="btn btn-secondary" disabled={quick.busy || a.status === 'lost'} onClick={() => setStatus('lost', 'Recorded as not awarded.')}>
                  Not awarded
                </button>
                {a.status === 'submitted' ? (
                  <button type="button" className="btn btn-secondary" disabled={quick.busy} onClick={() => setStatus('withdrawn', 'Recorded as withdrawn.')}>
                    Withdrawn
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost" disabled={quick.busy} onClick={() => setStatus('submitted', 'The result was undone. The bid shows as submitted again.')}>
                    Undo result
                  </button>
                )}
              </div>
              {o ? <AwardSection opportunity={o} application={a} onChange={res.reload} /> : null}
            </>
          ) : null}
        </Section>
      ) : null}

      {!locked ? (
        <Section title="Submit" id="submit">
          {a.channel === 'email' ? (
            <>
              <p>
                This bid goes by e-mail to <strong>{a.toEmail || 'no address yet'}</strong>
                {a.ccEmail ? <> (copy to {a.ccEmail})</> : null}.
              </p>
              <div className="button-row">
                <button type="button" className="btn btn-primary" disabled={!canSendEmail || dirty || send.busy} onClick={() => setConfirmSend(true)}>
                  <Icon name="send" size={16} /> Send submission
                </button>
                <a className="btn btn-secondary" href={packageUrl} target="_blank" rel="noopener">
                  Preview package (PDF)
                </a>
                <button type="button" className="btn btn-ghost" onClick={() => setMarkOpen(true)}>
                  I sent it myself
                </button>
              </div>
              {dirty ? <p className="small muted">Saving your changes first…</p> : null}
              {!dirty && !canSendEmail && a.missing.length > 0 ? <p className="small muted">Sending is possible once nothing is missing.</p> : null}
            </>
          ) : (
            <>
              <ol className="steps">
                <li>
                  <div>
                    <p className="step-title">Download the package</p>
                    <p className="small muted">
                      Your cover letter, company profile and attachments in one PDF.{' '}
                      <a href={packageUrl} target="_blank" rel="noopener">
                        Preview it first
                      </a>
                      .
                    </p>
                  </div>
                  <a className="btn btn-primary" href={packageUrl} download>
                    <Icon name="download" size={16} /> Download package
                  </a>
                </li>
                <li>
                  <div>
                    <p className="step-title">{a.channel === 'portal' ? 'Upload it on the buyer’s portal' : 'Print and deliver it'}</p>
                    <p className="small muted">
                      {a.channel === 'portal'
                        ? `Submit on ${o ? SUBMISSION_METHOD_LABELS[o.submissionMethod] : 'the buyer’s portal'} before the closing time. Add the buyer’s own forms there too.`
                        : 'Deliver it to the address in the bid documents before the closing time.'}
                    </p>
                  </div>
                  {portalUrl ? (
                    <ExternalLink href={portalUrl} className="btn btn-secondary">
                      {a.channel === 'portal' ? 'Open the buyer’s portal' : 'Open the notice'}
                    </ExternalLink>
                  ) : null}
                </li>
                <li>
                  <div>
                    <p className="step-title">Mark it as submitted here</p>
                    <p className="small muted">So Lgbids stops reminding you and you can record the result later.</p>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => setMarkOpen(true)}>
                    <Icon name="check" size={16} /> Mark as submitted
                  </button>
                </li>
              </ol>
            </>
          )}
          <Live message={send.message?.ok ? send.message : null} />
        </Section>
      ) : null}

      <div className="detail-grid">
        <div className="detail-main">
          <form
            className="card form-card"
            id="price-letter"
            aria-labelledby="letter-title"
            onSubmit={(e) => {
              e.preventDefault();
              saveDraft();
            }}
          >
            <div className="card-head">
              <h2 id="letter-title">Price and letter</h2>
            </div>
            <fieldset className="radio-list" disabled={locked}>
              <legend>How will this be submitted?</legend>
              {CHANNEL_OPTIONS.map((c) => (
                <label key={c.value} className="radio">
                  <input type="radio" name="channel" value={c.value} checked={draft.channel === c.value} onChange={() => set('channel', c.value)} />
                  <span>
                    <strong>{c.label}</strong>
                    <span className="hint">{c.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="grid-2">
              <Field label="Total price (CAD)" hint="Leave empty if the buyer asks only for unit rates." optional>
                <NumberInput value={draft.priceTotal} min={0} step="any" disabled={locked} onChange={(v) => set('priceTotal', v)} />
              </Field>
              <div className="field">
                <span className="label-like">As written in the letter</span>
                <p className="money-preview">{formatMoney(draft.priceTotal)}</p>
              </div>
            </div>
            <Field label="Price notes" hint="For example what is included, GST, or how long prices are held." optional>
              <textarea rows={3} value={draft.priceNotes} disabled={locked} onChange={(e) => set('priceNotes', e.target.value)} />
            </Field>
            <Check label="Include my rates table in the package" checked={draft.includeRates} disabled={locked} onChange={(v) => set('includeRates', v)} />

            {draft.channel === 'email' ? (
              <>
                <div className="grid-2">
                  <Field label="Send to" error={emailProblem(draft.toEmail)}>
                    <input type="email" value={draft.toEmail} disabled={locked} onChange={(e) => set('toEmail', e.target.value)} />
                  </Field>
                  <Field label="Copy to" hint="Separate several addresses with commas." optional>
                    <input type="text" value={draft.ccEmail} disabled={locked} onChange={(e) => set('ccEmail', e.target.value)} />
                  </Field>
                </div>
                <Field label="Subject">
                  <input type="text" value={draft.subject} disabled={locked} onChange={(e) => set('subject', e.target.value)} />
                </Field>
                <Field label="Letter" hint="This is the e-mail the buyer receives. The package PDF is attached.">
                  {preview ? (
                  <div className="letter-preview" tabIndex={0} aria-label="Letter preview">
                    <PlainText text={draft.body} />
                  </div>
                ) : (
                  <textarea rows={16} className="letter" value={draft.body} disabled={locked} onChange={(e) => set('body', e.target.value)} />
                )}
                </Field>
              </>
            ) : (
              <Field label="Cover letter" hint="Printed as the first page of the package.">
                {preview ? (
                  <div className="letter-preview" tabIndex={0} aria-label="Letter preview">
                    <PlainText text={draft.body} />
                  </div>
                ) : (
                  <textarea rows={14} className="letter" value={draft.body} disabled={locked} onChange={(e) => set('body', e.target.value)} />
                )}
              </Field>
            )}

            <p className="small">
              <button type="button" className="btn btn-ghost btn-small" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
                {preview ? 'Back to editing' : 'Preview the letter as the buyer reads it'}
              </button>
            </p>
            <Field label="Your notes" hint="Private. Never sent to the buyer." optional>
              <textarea rows={3} value={draft.notes} disabled={locked} onChange={(e) => set('notes', e.target.value)} />
            </Field>

            {!locked ? (
              <div className="form-footer">
                <p className={`save-status small ${saveFailed ? 'text-bad' : 'muted'}`} role="status">
                  {saveFailed ? (
                    `Not saved: ${save.message?.text ?? 'the server refused the change.'} Correct it and it saves again.`
                  ) : save.busy || dirty ? (
                    <>
                      <span className="spinner" aria-hidden="true" /> Saving…
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={14} /> All changes saved
                    </>
                  )}
                </p>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmRegen(true)}>
                  Rebuild letter from profile
                </button>
              </div>
            ) : null}
          </form>
        </div>

        <div className="detail-side">
          <Section title="Checklist" id="checklist">
            {a.checklist.length === 0 ? (
              <p className="muted">Nothing to tick for this bid.</p>
            ) : (
              <ul className="checklist">
                {a.checklist.map((c) => (
                  <li key={c.key}>
                    <Check
                      label={
                        <>
                          {c.label}
                          {c.required ? <span className="req-tag"> (required)</span> : null}
                        </>
                      }
                      hint={c.detail || undefined}
                      checked={c.done}
                      disabled={locked || quick.busy}
                      onChange={(done) =>
                        patch(
                          { checklist: a.checklist.map((x) => ({ key: x.key, done: x.key === c.key ? done : x.done })) },
                          done ? `Ticked: ${c.label}.` : `Unticked: ${c.label}.`,
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            <Live message={quick.message} />
          </Section>

          <Section title="Attach from your documents">
            {docs.loading && !docs.data ? <Loading /> : null}
            {docs.error ? <p className="live-bad">{docs.error}</p> : null}
            {docs.data && libraryDocs.length === 0 ? (
              <p className="muted">
                Your document library is empty. <Link to="/documents">Add your insurance certificate and WorkSafeBC letter</Link> so they can be attached.
              </p>
            ) : null}
            {libraryDocs.length > 0 ? (
              <ul className="checklist">
                {libraryDocs.map((d) => (
                  <li key={d.id}>
                    <Check
                      label={d.name}
                      hint={`${DOCUMENT_KIND_LABELS[d.kind]} · ${formatBytes(d.size)}`}
                      checked={a.documentIds.includes(d.id)}
                      disabled={locked || quick.busy}
                      onChange={(on) =>
                        patch(
                          { documentIds: on ? [...a.documentIds, d.id] : a.documentIds.filter((x) => x !== d.id) },
                          on ? `${d.name} will be attached.` : `${d.name} will not be attached.`,
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          <Section title="Buyer’s forms and other files">
            <p className="muted small">Add the buyer’s completed forms or anything else to include with this bid.</p>
            {a.files.length > 0 ? (
              <ul className="file-list">
                {a.files.map((f) => (
                  <li key={f.id}>
                    <a href={`/api/applications/${a.id}/files/${f.id}`} download>
                      {f.name}
                    </a>
                    <span className="muted small">{formatBytes(f.size)}</span>
                    {!locked ? (
                      <button type="button" className="btn btn-ghost btn-small" aria-label={`Remove ${f.name}`} onClick={() => removeFile(f.id, f.name)}>
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No files added.</p>
            )}
            {!locked ? (
              <div className="field">
                <label htmlFor={fileId}>Add files</label>
                <input
                  id={fileId}
                  type="file"
                  multiple
                  disabled={upload.busy}
                  onChange={(e) => {
                    uploadFiles(e.target.files).finally(() => {
                      e.target.value = '';
                    });
                  }}
                />
              </div>
            ) : null}
            <Live message={upload.message} />
          </Section>

          {!locked ? (
            <Section title="Not going ahead?">
              <p className="muted small">Withdraw this application if you decide not to bid. You can reopen it later while the bid is open.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmWithdraw(true)}>
                Withdraw this application
              </button>
            </Section>
          ) : a.status === 'withdrawn' && o && o.status === 'open' && !closing?.past ? (
            <Section title="Changed your mind?">
              <button type="button" className="btn btn-secondary" onClick={() => setStatus('needs_input', 'The application is open again.')}>
                Reopen this application
              </button>
            </Section>
          ) : null}
        </div>
      </div>

      {!locked ? (
        <div className="mobile-action-bar">
          {a.missing.length > 0 ? (
            <a href={a.missing.some((m) => /total price/i.test(m)) ? '#price-letter' : '#checklist'} className="btn btn-primary btn-block">
              {a.missing.length === 1 ? 'Finish the last item' : `Finish ${a.missing.length} items`}
            </a>
          ) : a.channel === 'email' ? (
            <button type="button" className="btn btn-primary btn-block" disabled={!canSendEmail || dirty || send.busy} onClick={() => setConfirmSend(true)}>
              <Icon name="send" size={16} /> Send submission
            </button>
          ) : (
            <a className="btn btn-primary btn-block" href={packageUrl} download>
              <Icon name="download" size={16} /> Download package
            </a>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmSend}
        title="Send this submission?"
        confirmLabel="Send now"
        busy={send.busy}
        onClose={() => setConfirmSend(false)}
        onConfirm={doSend}
      >
        <p className="formal-warning">
          <strong>This is a formal offer to the buyer. Check the price and attachments.</strong>
        </p>
        <dl className="facts">
          <div>
            <dt>To</dt>
            <dd>{a.toEmail || 'No address'}</dd>
          </div>
          {a.ccEmail ? (
            <div>
              <dt>Copy to</dt>
              <dd>{a.ccEmail}</dd>
            </div>
          ) : null}
          <div>
            <dt>Closes</dt>
            <dd>{closing ? `${closing.absolute} (${closing.relative.toLowerCase()})` : 'Not stated'}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>
              {a.priceTotal ? formatMoney(a.priceTotal) : a.includeRates ? 'Your rates table (in the package)' : 'Not entered'}
              {a.priceTotal && a.includeRates ? ', plus your rates table' : ''}
            </dd>
          </div>
          <div>
            <dt>Attachments</dt>
            <dd>
              <ul className="plain-list">
                <li>Bid package (PDF)</li>
                {attachedDocs.map((d) => (
                  <li key={d.id}>{d.name}</li>
                ))}
                {a.files.map((f) => (
                  <li key={f.id}>{f.name}</li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmRegen}
        title="Rebuild the letter?"
        confirmLabel="Rebuild letter"
        danger
        busy={quick.busy}
        onClose={() => setConfirmRegen(false)}
        onConfirm={regenerate}
      >
        <p>The subject and letter are replaced with a fresh draft built from your company profile. Your edits to them will be lost.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmWithdraw}
        title="Withdraw this application?"
        confirmLabel="Withdraw"
        danger
        busy={quick.busy}
        onClose={() => setConfirmWithdraw(false)}
        onConfirm={async () => {
          await setStatus('withdrawn', 'The application was withdrawn.');
          setConfirmWithdraw(false);
        }}
      >
        <p>Nothing is sent to the buyer. The application moves to “Finished”.</p>
      </ConfirmDialog>

      <MarkSubmittedDialog
        open={markOpen}
        defaultVia={
          a.channel === 'email' ? 'E-mail from my own mailbox' : a.channel === 'portal' && o ? SUBMISSION_METHOD_LABELS[o.submissionMethod] : 'Delivered in person'
        }
        onClose={() => setMarkOpen(false)}
        onDone={(updated) => {
          res.setData(updated);
          setMarkOpen(false);
        }}
        applicationId={a.id}
      />
    </>
  );
}

/** Keep the full text of a failed send visible until the next attempt. */
function useSendErrorSync(message: { ok: boolean; text: string } | null, setError: (e: string | null) => void) {
  useEffect(() => {
    if (message && !message.ok) setError(message.text);
  }, [message, setError]);
}

function MarkSubmittedDialog({
  open,
  defaultVia,
  applicationId,
  onClose,
  onDone,
}: {
  open: boolean;
  defaultVia: string;
  applicationId: number;
  onClose: () => void;
  onDone: (a: Application) => void;
}) {
  const [via, setVia] = useState(defaultVia);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const action = useAction();

  useEffect(() => {
    if (open) {
      setVia(defaultVia);
      setRef('');
      setNote('');
      action.clear();
    }
  }, [open, defaultVia]);

  async function submit() {
    const updated = await action.run(() =>
      api.post<Application>(`/api/applications/${applicationId}/mark-submitted`, { via: via.trim(), ref: ref.trim() || undefined, note: note.trim() || undefined }),
    );
    if (updated) onDone(updated);
  }

  return (
    <Dialog
      open={open}
      title="Mark as submitted"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={action.busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={action.busy || via.trim() === ''}>
            {action.busy ? 'Saving…' : 'Mark as submitted'}
          </button>
        </>
      }
    >
      <p>Record where and how you submitted this bid, so you have it on file.</p>
      <Field label="Where or how did you submit it?">
        <input type="text" value={via} required onChange={(e) => setVia(e.target.value)} />
      </Field>
      <Field label="Confirmation number" hint="The receipt or confirmation number from the portal, if you got one." optional>
        <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <Field label="Note" optional>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Live message={action.message} />
    </Dialog>
  );
}
