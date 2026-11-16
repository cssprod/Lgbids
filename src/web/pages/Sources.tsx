import { useState, type FormEvent } from 'react';
import { api } from '../api.js';
import type { SourceTest } from '../../shared/api.js';
import type { SourceConfig, SourceInput, SourceKind, SourceRecord, SubmissionMethod } from '../../shared/schemas.js';
import { SOURCE_KINDS, SOURCE_KIND_LABELS, SUBMISSION_METHODS, SUBMISSION_METHOD_LABELS, sourceConfigSchema } from '../../shared/schemas.js';
import { useAction, useDocumentTitle, useFormat, useResource } from '../hooks.js';
import { ConfirmDialog } from '../components/Dialog.js';
import { SourceChip } from '../components/status.js';
import { TagEditor } from '../components/TagEditor.js';
import { Callout, Check, Empty, ErrorBox, ExternalLink, Field, Live, Loading, NumberInput, PageHeader, Section } from '../components/ui.js';
import { formatBytes, formatDuration, plural } from '../format.js';

const URL_LABEL: Record<SourceKind, [string, string]> = {
  canadabuys_csv: ['CSV file address', 'The open-data CSV of tender notices from CanadaBuys.'],
  canadabuys_search: ['Search page address', 'The CanadaBuys tender search page. Each search term is one request.'],
  bonfire: ['Portal address', 'The buyer’s Bonfire portal, for example https://example.bonfirehub.ca.'],
  rss: ['Feed address', 'An RSS or Atom feed of bid notices.'],
  html_list: ['Listing page address', 'A web page that lists the buyer’s current bids.'],
};

function defaultInput(): SourceInput {
  return { name: '', kind: 'html_list', enabled: true, notes: '', config: sourceConfigSchema.parse({}) };
}

export function SourcesPage() {
  useDocumentTitle('Sources');
  const res = useResource<SourceRecord[]>('/api/sources');
  const [adding, setAdding] = useState(false);

  function replace(s: SourceRecord) {
    if (res.data) res.setData(res.data.map((x) => (x.id === s.id ? s : x)));
  }

  return (
    <>
      <PageHeader
        title="Sources"
        intro={
          <p>
            The bid sites Lgbids reads. Each one is read a few times a day, slowly, and Lgbids follows each site’s robots.txt rules. Use “Test”
            to check a source is still working.
          </p>
        }
        actions={
          !adding ? (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              Add a source
            </button>
          ) : null
        }
      />

      {adding ? (
        <Section title="Add a source">
          <SourceForm
            initial={defaultInput()}
            submitLabel="Save source"
            onCancel={() => setAdding(false)}
            onSave={async (input) => {
              const created = await api.post<SourceRecord>('/api/sources', input);
              res.setData([...(res.data ?? []), created]);
              setAdding(false);
              return created;
            }}
          />
        </Section>
      ) : null}

      {res.loading && !res.data ? <Loading /> : null}
      {res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : null}
      {res.data && res.data.length === 0 ? (
        <Empty title="No sources yet." action={<button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>Add a source</button>}>
          <p>Add the bid pages of the buyers you work for, so Lgbids can read them.</p>
        </Empty>
      ) : null}
      {res.data && res.data.length > 0 ? (
        <ul className="source-list">
          {res.data.map((s) => (
            <SourceCard key={s.id} s={s} onChange={replace} onDeleted={() => res.setData((res.data ?? []).filter((x) => x.id !== s.id))} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function SourceCard({ s, onChange, onDeleted }: { s: SourceRecord; onChange: (s: SourceRecord) => void; onDeleted: () => void }) {
  const fmt = useFormat();
  const action = useAction();
  const test = useAction();
  const [result, setResult] = useState<SourceTest | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function toggle(enabled: boolean) {
    const updated = await action.run(
      () => api.patch<SourceRecord>(`/api/sources/${s.id}`, { enabled }),
      enabled ? `${s.name} is turned on.` : `${s.name} is turned off. It will not be read until you turn it on again.`,
    );
    if (updated) onChange(updated);
  }

  async function runTest() {
    setResult(null);
    const r = await test.run(() => api.post<SourceTest>(`/api/sources/${s.id}/test`));
    if (r) setResult(r);
  }

  async function remove() {
    const ok = await action.run(() => api.del<{ ok: true }>(`/api/sources/${s.id}`));
    setConfirmDelete(false);
    if (ok) onDeleted();
  }

  const failing = s.lastStatus === 'error' || s.lastStatus === 'blocked';

  return (
    <li className={`card source-card ${failing && s.enabled ? 'source-failing' : ''} ${s.enabled ? '' : 'source-off'}`}>
      <div className="source-head">
        <div>
          <h2 className="source-name">{s.name}</h2>
          <p className="row-meta">
            {SOURCE_KIND_LABELS[s.kind]}
            {s.builtin ? ' · built in' : ' · added by you'}
            {s.config.url ? (
              <>
                {' · '}
                <ExternalLink href={s.config.url}>site</ExternalLink>
              </>
            ) : null}
          </p>
        </div>
        <Check label={s.enabled ? 'On' : 'Off'} checked={s.enabled} disabled={action.busy} onChange={toggle} className="toggle" />
      </div>

      <div className="source-health">
        <SourceChip status={s.lastStatus} />
        <span className="small">
          {s.lastRunAt ? `Last read ${fmt.dateTime(s.lastRunAt)}` : 'Never read'}
          {s.lastItemCount !== null ? ` · ${plural(s.lastItemCount, 'notice')} listed` : ''}
          {s.consecutiveFailures > 1 ? ` · failed ${s.consecutiveFailures} times in a row` : ''}
        </span>
      </div>
      {s.lastMessage ? <p className={`small ${failing ? 'text-bad' : 'muted'}`}>{s.lastMessage}</p> : null}
      {failing && s.lastOkAt ? <p className="small muted">Last worked {fmt.dateTime(s.lastOkAt)}.</p> : null}
      {s.notes ? <p className="small">{s.notes}</p> : null}

      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={runTest} disabled={test.busy}>
          {test.busy ? 'Testing…' : 'Test'}
        </button>
        <button type="button" className="btn btn-ghost" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? 'Close editor' : 'Edit'}
        </button>
        {!s.builtin ? (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        ) : null}
      </div>
      <Live message={test.message ?? action.message} />
      {test.busy ? <Loading label="Reading the site. This can take up to a minute…" /> : null}
      {result ? <TestResult r={result} /> : null}

      {editing ? (
        <div className="sub-card">
          <SourceForm
            initial={{ name: s.name, kind: s.kind, enabled: s.enabled, notes: s.notes, config: s.config }}
            submitLabel="Save changes"
            lockKind={s.builtin}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              const updated = await api.patch<SourceRecord>(`/api/sources/${s.id}`, input);
              onChange(updated);
              setEditing(false);
              return updated;
            }}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${s.name}?`}
        confirmLabel="Delete source"
        danger
        busy={action.busy}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      >
        <p>Lgbids stops reading this site. Opportunities already found from it are kept.</p>
      </ConfirmDialog>
    </li>
  );
}

function TestResult({ r }: { r: SourceTest }) {
  const fmt = useFormat();
  return (
    <div className="test-result" aria-label="Test result" role="region">
      <p>
        <SourceChip status={r.status} /> <span className="small">
          {plural(r.count, 'notice')} found in {formatDuration(r.ms)}.
        </span>
      </p>
      {r.message ? <p className="small">{r.message}</p> : null}
      {r.sample.length > 0 ? (
        <>
          <h3>Sample notices</h3>
          <ul className="plain-list sample-list">
            {r.sample.map((n, i) => (
              <li key={i}>
                {n.url ? <ExternalLink href={n.url}>{n.title}</ExternalLink> : n.title}
                <span className="muted small">
                  {' '}
                  {[n.organization, n.referenceNumber, n.closesAt ? `closes ${fmt.dateTime(n.closesAt)}` : n.closingRaw ? `closing “${n.closingRaw}”` : 'no closing date found']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {r.requests.length > 0 ? (
        <details>
          <summary>Requests made ({r.requests.length})</summary>
          <table className="table stack">
            <thead>
              <tr>
                <th scope="col">Address</th>
                <th scope="col">Answer</th>
                <th scope="col">Size</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {r.requests.map((q, i) => (
                <tr key={i}>
                  <td data-label="Address" className="break">
                    {q.url}
                    {q.error ? <span className="text-bad small"> — {q.error}</span> : null}
                  </td>
                  <td data-label="Answer">{q.status ?? 'No answer'}</td>
                  <td data-label="Size">{formatBytes(q.bytes)}</td>
                  <td data-label="Time">{formatDuration(q.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}

function SourceForm({
  initial,
  submitLabel,
  lockKind,
  onSave,
  onCancel,
}: {
  initial: SourceInput;
  submitLabel: string;
  lockKind?: boolean;
  onSave: (input: SourceInput) => Promise<SourceRecord>;
  onCancel: () => void;
}) {
  const [v, setV] = useState<SourceInput>(initial);
  const save = useAction();
  const test = useAction();
  const [result, setResult] = useState<SourceTest | null>(null);
  const c = v.config;
  const setC = <K extends keyof SourceConfig>(k: K, val: SourceConfig[K]) => setV({ ...v, config: { ...c, [k]: val } });
  const [urlLabel, urlHint] = URL_LABEL[v.kind];

  async function submit(e: FormEvent) {
    e.preventDefault();
    await save.run(() => onSave(v), 'Saved.');
  }

  async function runTest() {
    setResult(null);
    const r = await test.run(() => api.post<SourceTest>('/api/sources/test', v));
    if (r) setResult(r);
  }

  return (
    <form onSubmit={submit} className="form-grid">
      <div className="grid-2">
        <Field label="Name" hint="For example “District of Saanich bids”.">
          <input type="text" required minLength={2} maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Kind of source" hint={lockKind ? 'Built-in sources keep their kind.' : undefined}>
          <select value={v.kind} disabled={lockKind} onChange={(e) => setV({ ...v, kind: e.target.value as SourceKind })}>
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {SOURCE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={urlLabel} hint={urlHint}>
        <input type="url" required value={c.url} placeholder="https://" onChange={(e) => setC('url', e.target.value)} />
      </Field>

      {v.kind === 'canadabuys_search' ? (
        <TagEditor
          label="Search terms"
          hint="Leave empty to use the built-in gardening and landscaping terms."
          values={c.queries}
          onChange={(q) => setC('queries', q)}
        />
      ) : null}

      {v.kind === 'html_list' ? (
        <fieldset className="sub-fieldset">
          <legend>Reading the listing page</legend>
          <div className="grid-2">
            <Field label="Link pattern" hint="A regular expression matched against each link’s path, for example /bids/\d+. Leave empty to guess." optional>
              <input type="text" value={c.linkPattern} onChange={(e) => setC('linkPattern', e.target.value)} />
            </Field>
            <Field label="Row selector" hint="A CSS selector for one listing row or card, for example table.bids tr." optional>
              <input type="text" value={c.itemSelector} onChange={(e) => setC('itemSelector', e.target.value)} />
            </Field>
            <Field label="Page parameter" hint="The address parameter used for more pages, for example “page”." optional>
              <input type="text" value={c.pageParam} onChange={(e) => setC('pageParam', e.target.value)} />
            </Field>
            <Field label="First page number" hint="Whether the site counts pages from 0 or 1.">
              <select value={c.pageStart} onChange={(e) => setC('pageStart', Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={0}>0</option>
              </select>
            </Field>
            <Field label="Pages to read" hint="Between 1 and 20.">
              <NumberInput value={c.maxPages} min={1} max={20} step={1} onChange={(n) => setC('maxPages', Math.min(20, Math.max(1, Math.round(n ?? 1))))} />
            </Field>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="sub-fieldset">
        <legend>About this source’s notices</legend>
        <div className="grid-2">
          <Field label="Buyer name" hint="Used when a notice does not name the buyer." optional>
            <input type="text" value={c.organization} onChange={(e) => setC('organization', e.target.value)} />
          </Field>
          <Field label="How bids are usually submitted" hint="Used when a notice does not say.">
            <select value={c.defaultSubmission} onChange={(e) => setC('defaultSubmission', e.target.value as SubmissionMethod)}>
              {SUBMISSION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {SUBMISSION_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Time zone for dates without one" hint="Usually America/Vancouver.">
            <input type="text" value={c.timeZone} onChange={(e) => setC('timeZone', e.target.value)} />
          </Field>
        </div>
        <Check label="Everything listed here is in my service area" hint="Tick for a local buyer’s own bid page." checked={c.localBuyer} onChange={(b) => setC('localBuyer', b)} />
        <Check label="Everything listed here is in British Columbia" hint="Tick for a province-wide listing." checked={c.bcOnly} onChange={(b) => setC('bcOnly', b)} />
        <Check
          label="Open each notice’s own page"
          hint="Reads the description, dates and documents. Slower, but scores are better."
          checked={c.fetchDetails}
          onChange={(b) => setC('fetchDetails', b)}
        />
      </fieldset>

      <Field label="Notes" optional>
        <textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>

      <div className="form-footer">
        <button type="submit" className="btn btn-primary" disabled={save.busy || v.name.trim().length < 2 || c.url.trim() === ''}>
          {save.busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn btn-secondary" onClick={runTest} disabled={test.busy || c.url.trim() === ''}>
          {test.busy ? 'Testing…' : 'Test before saving'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <Live message={save.message ?? test.message} />
      {result ? (
        result.status === 'ok' ? (
          <TestResult r={result} />
        ) : (
          <>
            <Callout tone="warn" title="The test did not find any notices.">
              <p>Check the address and settings. You can still save the source and fix it later.</p>
            </Callout>
            <TestResult r={result} />
          </>
        )
      ) : null}
    </form>
  );
}
