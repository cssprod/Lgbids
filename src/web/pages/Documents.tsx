import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../api.js';
import type { DocumentKind, LibraryDocument } from '../../shared/schemas.js';
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS } from '../../shared/schemas.js';
import { useAction, useApp, useDocumentTitle, useFormat, useResource } from '../hooks.js';
import { ConfirmDialog } from '../components/Dialog.js';
import { Check, Chip, Empty, ErrorBox, Field, Live, Loading, PageHeader, Section } from '../components/ui.js';
import { daysUntilPlainDate, formatBytes, formatPlainDate } from '../format.js';

function ExpiryChip({ expiresOn }: { expiresOn: string }) {
  const { timeZone } = useApp();
  if (!expiresOn) return <span className="muted small">No expiry date</span>;
  const days = daysUntilPlainDate(expiresOn, timeZone);
  const date = formatPlainDate(expiresOn);
  if (days === null) return <span className="small">Expires {expiresOn}</span>;
  if (days < 0)
    return (
      <Chip tone="bad" symbol="✕">
        Expired {date}
      </Chip>
    );
  if (days <= 30)
    return (
      <Chip tone="warn" symbol="!">
        Expires {date} ({days === 0 ? 'today' : `in ${days} ${days === 1 ? 'day' : 'days'}`})
      </Chip>
    );
  return <span className="small">Valid until {date}</span>;
}

export function DocumentsPage() {
  useDocumentTitle('Documents');
  const fmt = useFormat();
  const res = useResource<LibraryDocument[]>('/api/documents');
  const upload = useAction();
  const rowAction = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DocumentKind>('insurance');
  const [expiresOn, setExpiresOn] = useState('');
  const [attachByDefault, setAttachByDefault] = useState(true);
  const [toDelete, setToDelete] = useState<LibraryDocument | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('name', name.trim() || file.name);
    form.append('kind', kind);
    form.append('expiresOn', expiresOn);
    form.append('attachByDefault', attachByDefault ? 'true' : 'false');
    const doc = await upload.run(() => api.upload<LibraryDocument>('/api/documents', form), (d) => `${d.name} was added to your library.`);
    if (doc) {
      res.setData([doc, ...(res.data ?? [])]);
      setFile(null);
      setName('');
      setExpiresOn('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function toggleDefault(d: LibraryDocument, on: boolean) {
    const updated = await rowAction.run(
      () => api.patch<LibraryDocument>(`/api/documents/${d.id}`, { attachByDefault: on }),
      on ? `${d.name} will be attached to new applications.` : `${d.name} will no longer be attached automatically.`,
    );
    if (updated && res.data) res.setData(res.data.map((x) => (x.id === d.id ? updated : x)));
  }

  async function remove() {
    const d = toDelete;
    if (!d) return;
    const ok = await rowAction.run(() => api.del<{ ok: true }>(`/api/documents/${d.id}`), `${d.name} was deleted.`);
    if (ok && res.data) res.setData(res.data.filter((x) => x.id !== d.id));
    setToDelete(null);
  }

  return (
    <>
      <PageHeader
        title="Documents"
        intro={<p>Your standing documents, such as the insurance certificate and WorkSafeBC clearance letter. Attach them to any application.</p>}
      />

      <Section title="Add a document">
        <form onSubmit={submit} className="form-grid">
          <div className="field">
            <label htmlFor={fileId}>File</label>
            <input
              id={fileId}
              ref={fileRef}
              type="file"
              required
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !name) setName(f.name.replace(/\.[^.]+$/, ''));
              }}
            />
          </div>
          <div className="grid-2">
            <Field label="Name" hint="How it is listed and named in submissions.">
              <input type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Kind">
              <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expiry date" hint="Lgbids warns you 30 days before it expires." optional>
              <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </Field>
          </div>
          <Check label="Attach to new applications by default" checked={attachByDefault} onChange={setAttachByDefault} />
          <div className="form-footer">
            <button type="submit" className="btn btn-primary" disabled={!file || upload.busy}>
              {upload.busy ? 'Uploading…' : 'Add to library'}
            </button>
            <Live message={upload.message} />
          </div>
        </form>
      </Section>

      <Section title="Your library">
        <Live message={rowAction.message} />
        {res.loading && !res.data ? <Loading /> : null}
        {res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : null}
        {res.data && res.data.length === 0 ? (
          <Empty title="No documents yet.">
            <p>Start with your certificate of insurance and your WorkSafeBC clearance letter — almost every bid asks for them.</p>
          </Empty>
        ) : null}
        {res.data && res.data.length > 0 ? (
          <ul className="rows">
            {res.data.map((d) => (
              <li key={d.id} className="row doc-row">
                <div className="row-main">
                  <a href={`/api/documents/${d.id}/download`} className="row-title" download>
                    {d.name}
                  </a>
                  <p className="row-meta">
                    {DOCUMENT_KIND_LABELS[d.kind]} · {d.filename} · {formatBytes(d.size)} · added {fmt.date(d.createdAt)}
                  </p>
                  <p>
                    <ExpiryChip expiresOn={d.expiresOn} />
                  </p>
                </div>
                <div className="row-side doc-actions">
                  <Check label="Attach by default" checked={d.attachByDefault} disabled={rowAction.busy} onChange={(v) => toggleDefault(d, v)} />
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setToDelete(d)}>
                    Delete<span className="visually-hidden"> {d.name}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this document?"
        confirmLabel="Delete"
        danger
        busy={rowAction.busy}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
      >
        <p>
          <strong>{toDelete?.name}</strong> is removed from your library. Submissions already sent are not affected.
        </p>
      </ConfirmDialog>
    </>
  );
}
