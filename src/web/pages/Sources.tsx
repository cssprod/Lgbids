import { useState } from 'react';
import { api } from '../api.js';
import type { SourceTest } from '../../shared/api.js';
import type { SourceRecord } from '../../shared/schemas.js';
import { SOURCE_KIND_LABELS } from '../../shared/schemas.js';
import { useAction, useDocumentTitle, useFormat, useResource } from '../hooks.js';
import { ConfirmDialog } from '../components/Dialog.js';
import { SourceChip } from '../components/status.js';
import { Check, Empty, ErrorBox, ExternalLink, Live, Loading, PageHeader } from '../components/ui.js';
import { formatBytes, formatDuration, plural } from '../format.js';

export function SourcesPage() {
  useDocumentTitle('Sources');
  const res = useResource<SourceRecord[]>('/api/sources');

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
      />

      {res.loading && !res.data ? <Loading /> : null}
      {res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : null}
      {res.data && res.data.length === 0 ? (
        <Empty title="No sources are set up.">
          <p>The built-in Greater Victoria bid sites are missing. Restart Lgbids to restore them.</p>
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
        {!s.builtin ? (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        ) : null}
      </div>
      <Live message={test.message ?? action.message} />
      {test.busy ? <Loading label="Reading the site. This can take up to a minute…" /> : null}
      {result ? <TestResult r={result} /> : null}

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
