import { Link } from 'react-router-dom';
import type { EventRecord, RunRecord } from '../../shared/schemas.js';
import { useDocumentTitle, useFormat, useResource } from '../hooks.js';
import { RunChip, SourceChip, TRIGGER_TEXT } from '../components/status.js';
import { Empty, ErrorBox, Loading, PageHeader, Section } from '../components/ui.js';
import { formatDuration } from '../format.js';

const LEVEL: Record<EventRecord['level'], [string, string]> = {
  info: ['•', 'Info'],
  warn: ['!', 'Warning'],
  error: ['✕', 'Problem'],
};

const COUNTS: { key: 'found' | 'added' | 'analysed' | 'suitable' | 'drafted' | 'sent' | 'expired'; label: string }[] = [
  { key: 'found', label: 'Checked' },
  { key: 'added', label: 'New' },
  { key: 'analysed', label: 'Scored' },
  { key: 'suitable', label: 'Suitable' },
  { key: 'drafted', label: 'Drafted' },
  { key: 'sent', label: 'Sent' },
  { key: 'expired', label: 'Expired' },
];

function RunItem({ r }: { r: RunRecord }) {
  const fmt = useFormat();
  const ms = r.finishedAt ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime() : null;
  return (
    <li className="run">
      <details>
        <summary>
          <span className="run-when">
            <strong>{fmt.dateTime(r.startedAt)}</strong>
            <span className="muted small">
              {' '}
              {TRIGGER_TEXT[r.trigger]}
              {ms !== null ? ` · took ${formatDuration(ms)}` : ''}
            </span>
          </span>
          <RunChip status={r.status} />
        </summary>
        {r.error ? <p className="text-bad small">{r.error}</p> : null}
        {r.stats ? (
          <>
            <dl className="run-counts">
              {COUNTS.map((c) => (
                <div key={c.key}>
                  <dt>{c.label}</dt>
                  <dd>{r.stats![c.key]}</dd>
                </div>
              ))}
            </dl>
            {r.stats.sources.length > 0 ? (
              <table className="table stack">
                <caption className="visually-hidden">Sources read in this check</caption>
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Result</th>
                    <th scope="col">Listed</th>
                    <th scope="col">New</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {r.stats.sources.map((s) => (
                    <tr key={s.sourceId}>
                      <td data-label="Source">
                        {s.name}
                        {s.message ? <span className="muted small block">{s.message}</span> : null}
                      </td>
                      <td data-label="Result">
                        <SourceChip status={s.status} />
                      </td>
                      <td data-label="Listed">{s.found}</td>
                      <td data-label="New">{s.added}</td>
                      <td data-label="Time">{formatDuration(s.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : (
          <p className="muted small">{r.status === 'running' ? 'Still running.' : 'No details were recorded.'}</p>
        )}
      </details>
    </li>
  );
}

export function ActivityPage() {
  useDocumentTitle('Activity');
  const fmt = useFormat();
  const runs = useResource<RunRecord[]>('/api/runs');
  const events = useResource<EventRecord[]>('/api/events?limit=100');

  return (
    <>
      <PageHeader title="Activity" intro={<p>Every check of the bid sites, and what Lgbids did.</p>} />
      <div className="two-col activity">
        <Section title="Checks">
          {runs.loading && !runs.data ? <Loading /> : null}
          {runs.error ? <ErrorBox message={runs.error} onRetry={runs.reload} /> : null}
          {runs.data && runs.data.length === 0 ? (
            <Empty title="No checks yet." action={<Link to="/">Go to Today and press “Run now”</Link>}>
              <p>Checks run on your schedule, or when you press “Run now”.</p>
            </Empty>
          ) : null}
          {runs.data && runs.data.length > 0 ? (
            <ul className="runs">
              {runs.data.map((r) => (
                <RunItem key={r.id} r={r} />
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title="Recent events">
          {events.loading && !events.data ? <Loading /> : null}
          {events.error ? <ErrorBox message={events.error} onRetry={events.reload} /> : null}
          {events.data && events.data.length === 0 ? (
            <Empty title="Nothing has happened yet.">
              <p>Found bids, drafted applications, sent submissions and problems are listed here.</p>
            </Empty>
          ) : null}
          {events.data && events.data.length > 0 ? (
            <ul className="events">
              {events.data.map((e) => {
                const [symbol, label] = LEVEL[e.level];
                return (
                  <li key={e.id} className={`event event-${e.level}`}>
                    <span className="event-symbol" aria-hidden="true">
                      {symbol}
                    </span>
                    <div>
                      <p className="event-msg">
                        <span className="visually-hidden">{label}: </span>
                        {e.message}
                      </p>
                      <p className="muted small">
                        <time dateTime={e.at}>{fmt.dateTime(e.at)}</time>
                        {e.applicationId ? (
                          <>
                            {' · '}
                            <Link to={`/applications/${e.applicationId}`}>Application</Link>
                          </>
                        ) : e.opportunityId ? (
                          <>
                            {' · '}
                            <Link to={`/opportunities/${e.opportunityId}`}>Opportunity</Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Section>
      </div>
    </>
  );
}
