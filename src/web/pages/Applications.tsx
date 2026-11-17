import { Link } from 'react-router-dom';
import type { Application, ApplicationChannel, ApplicationStatus } from '../../shared/schemas.js';
import { useDocumentTitle, useFormat, useResource } from '../hooks.js';
import { ApplicationChip } from '../components/status.js';
import { Empty, ErrorBox, PageHeader, SkeletonList } from '../components/ui.js';
import { plural } from '../format.js';

export const CHANNEL_TEXT: Record<ApplicationChannel, string> = {
  email: 'Sent by e-mail',
  portal: 'Uploaded to a portal by you',
  manual: 'Delivered by you',
};

const GROUPS: { title: string; statuses: ApplicationStatus[]; intro: string; collapsed?: boolean }[] = [
  { title: 'Needs your input', statuses: ['needs_input'], intro: 'Fill in what is missing, then these can be sent.' },
  { title: 'Send failed', statuses: ['failed'], intro: 'These could not be sent. Open one to see why.' },
  { title: 'Ready to submit', statuses: ['ready', 'sending'], intro: 'Check each one, then send it or upload it to the buyer’s portal.' },
  { title: 'Submitted', statuses: ['submitted'], intro: 'Waiting for the buyer’s decision.' },
  { title: 'Finished', statuses: ['won', 'lost', 'withdrawn', 'expired'], intro: 'Won, not awarded, withdrawn or closed before submitting.', collapsed: true },
];

function groupId(title: string): string {
  return `stage-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
}

export function ApplicationsPage() {
  useDocumentTitle('Applications');
  const res = useResource<Application[]>('/api/applications');

  return (
    <>
      <PageHeader title="Applications" intro={<p>Your drafted and submitted bids.</p>} />
      {res.loading && !res.data ? <SkeletonList rows={5} label="Loading applications…" /> : null}
      {res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : null}
      {res.data && res.data.length === 0 ? (
        <Empty title="No applications yet." action={<Link to="/opportunities" className="btn btn-primary">See suitable opportunities</Link>}>
          <p>
            Lgbids drafts an application for each suitable bid it finds (in “prepare” mode), or when you press “Pursue” on an opportunity.
          </p>
        </Empty>
      ) : null}
      {res.data && res.data.length > 0 ? (
        <nav className="stage-strip" aria-label="Application stages">
          {GROUPS.map((g) => {
            const n = res.data!.filter((a) => g.statuses.includes(a.status)).length;
            if (n === 0 && g.statuses.includes('failed')) return null;
            return (
              <a key={g.title} href={`#${groupId(g.title)}`} className={`stage ${n > 0 && g.statuses.some((s) => s === 'needs_input' || s === 'failed') ? 'stage-warn' : ''}`}>
                <span className="stage-count">{n}</span>
                <span className="stage-label">{g.title}</span>
              </a>
            );
          })}
        </nav>
      ) : null}
      {res.data && res.data.length > 0
        ? GROUPS.map((g) => {
            const items = res.data!.filter((a) => g.statuses.includes(a.status));
            if (items.length === 0 && (g.collapsed || g.statuses.includes('failed'))) return null;
            const list =
              items.length === 0 ? (
                <p className="muted">None right now.</p>
              ) : (
                <ul className="rows">
                  {items.map((a) => (
                    <ApplicationRow key={a.id} a={a} />
                  ))}
                </ul>
              );
            if (g.collapsed) {
              return (
                <details key={g.title} className="card group" id={groupId(g.title)}>
                  <summary>
                    <h2>
                      {g.title} <span className="count">{items.length}</span>
                    </h2>
                  </summary>
                  <p className="muted small">{g.intro}</p>
                  {list}
                </details>
              );
            }
            return (
              <section key={g.title} className="card group" aria-label={g.title} id={groupId(g.title)}>
                <div className="card-head">
                  <h2>
                    {g.title} <span className="count">{items.length}</span>
                  </h2>
                </div>
                <p className="muted small">{g.intro}</p>
                {list}
              </section>
            );
          })
        : null}
    </>
  );
}

function ApplicationRow({ a }: { a: Application }) {
  const fmt = useFormat();
  const o = a.opportunity;
  const c = o ? fmt.closing(o.closesAt, o.closesAtPrecision, o.closesAtRaw) : null;
  return (
    <li className="row">
      <div className="row-main">
        <Link to={`/applications/${a.id}`} className="row-title">
          {o?.title ?? `Application ${a.id}`}
        </Link>
        <p className="row-meta">
          {o?.organization}
          {' · '}
          {CHANNEL_TEXT[a.channel]}
          {a.status === 'submitted' && a.submittedAt ? ` · submitted ${fmt.date(a.submittedAt)}` : ''}
        </p>
        {a.missing.length > 0 && (a.status === 'needs_input' || a.status === 'ready') ? (
          <p className="small text-warn">
            <span aria-hidden="true">! </span>
            {plural(a.missing.length, 'thing')} missing: {a.missing.slice(0, 2).join('; ')}
            {a.missing.length > 2 ? '…' : ''}
          </p>
        ) : null}
      </div>
      <div className="row-side">
        <ApplicationChip status={a.status} />
        {c && ['needs_input', 'ready', 'failed', 'sending'].includes(a.status) ? (
          <span className={`small ${c.soon ? 'text-warn strong' : 'muted'}`}>{c.relative}</span>
        ) : null}
      </div>
    </li>
  );
}
