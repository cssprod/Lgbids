import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import type { DashboardResponse, RunState } from '../../shared/api.js';
import type { AutomationMode, RunRecord } from '../../shared/schemas.js';
import { useAction, useDocumentTitle, useFormat, useInterval, useResource } from '../hooks.js';
import { ApplicationChip, SourceChip, TRIGGER_TEXT } from '../components/status.js';
import { Callout, Empty, ErrorBox, Live, Loading, PageHeader, Section } from '../components/ui.js';
import { plural } from '../format.js';

const MODE_TEXT: Record<AutomationMode, { title: string; detail: string }> = {
  off: {
    title: 'Automation is off',
    detail: 'Lgbids only looks for new bids when you press “Run now”.',
  },
  discover: {
    title: 'Finding and scoring bids',
    detail: 'Lgbids checks the bid sites on a schedule and scores what it finds. It does not draft applications.',
  },
  prepare: {
    title: 'Finding bids and drafting applications for your approval',
    detail: 'Nothing is sent to a buyer until you review it and press “Send submission”.',
  },
  auto: {
    title: 'Fully automatic',
    detail: 'Complete e-mail submissions that meet your automatic sending rules are sent without your review. Everything else waits for you.',
  },
};

function runSummary(run: RunRecord): string {
  const s = run.stats;
  if (!s) return run.error || 'No details were recorded.';
  const parts = [
    `${plural(s.found, 'notice')} checked`,
    `${s.added} new`,
    `${s.suitable} suitable`,
    `${plural(s.drafted, 'application')} drafted`,
  ];
  if (s.sent > 0) parts.push(`${plural(s.sent, 'submission')} sent`);
  return parts.join(', ') + '.';
}

export function DashboardPage({ onTimeZone }: { onTimeZone: (tz: string) => void }) {
  useDocumentTitle('Today');
  const fmt = useFormat();
  const dash = useResource<DashboardResponse>('/api/dashboard');
  const run = useAction();
  const [polling, setPolling] = useState(false);

  const d = dash.data;

  useEffect(() => {
    if (d?.timeZone) onTimeZone(d.timeZone);
    if (d?.running) setPolling(true);
  }, [d, onTimeZone]);

  useInterval(
    () => {
      api.get<RunState>('/api/runs/current').then(
        (s) => {
          if (!s.running) {
            setPolling(false);
            dash.reload();
            run.setMessage({
              ok: s.run?.status !== 'error',
              text: s.run ? `The check has finished. ${runSummary(s.run)}` : 'The check has finished.',
            });
          }
        },
        () => {},
      );
    },
    2000,
    polling,
  );

  async function runNow() {
    const res = await run.run(() => api.post<RunState>('/api/runs'), 'Checking the bid sites now. This usually takes a minute or two.');
    if (res) setPolling(true);
  }

  if (dash.loading && !d) return <Loading />;
  if (dash.error && !d) return <ErrorBox message={dash.error} onRetry={dash.reload} />;
  if (!d) return null;

  const mode = MODE_TEXT[d.mode];
  const running = polling || d.running;
  const setupLeft = d.setup.filter((s) => !s.done);
  const failing = d.sources.filter((s) => s.enabled && (s.lastStatus === 'error' || s.lastStatus === 'blocked'));
  const tiles: { label: string; value: number; to: string; tone?: string }[] = [
    { label: 'Suitable and open', value: d.counts.openSuitable, to: '/opportunities?view=suitable' },
    { label: 'Need a review', value: d.counts.review, to: '/opportunities?view=review' },
    { label: 'Need your input', value: d.counts.needsInput, to: '/applications', tone: d.counts.needsInput > 0 ? 'warn' : '' },
    { label: 'Ready to submit', value: d.counts.ready, to: '/applications', tone: d.counts.ready > 0 ? 'info' : '' },
    { label: 'Submitted', value: d.counts.submitted, to: '/applications' },
    { label: 'Closing within 7 days', value: d.counts.closingSoon, to: '/opportunities?view=suitable' },
  ];

  return (
    <>
      {d.demo ? (
        <div className="demo-banner" role="note">
          <strong>Demo mode</strong> — these are invented sample notices, not real opportunities. Nothing is sent to real buyers.
        </div>
      ) : null}
      <PageHeader
        title="Today"
        actions={
          <button type="button" className="btn btn-primary" onClick={runNow} disabled={running || run.busy}>
            {running ? (
              <>
                <span className="spinner" aria-hidden="true" /> Checking…
              </>
            ) : (
              'Run now'
            )}
          </button>
        }
      />
      <Live message={run.message} />

      <section className="card status-card" aria-labelledby="mode-title">
        <div className="status-mode">
          <p className="eyebrow">Automation</p>
          <h2 id="mode-title">{mode.title}</h2>
          <p>{mode.detail}</p>
          <p className="small">
            <Link to="/settings">Change automation settings</Link>
          </p>
        </div>
        <dl className="status-facts">
          <div>
            <dt>Last check</dt>
            <dd>
              {d.lastRun ? (
                <>
                  {fmt.dateTime(d.lastRun.startedAt)} ({TRIGGER_TEXT[d.lastRun.trigger].toLowerCase()})
                  <br />
                  <span className="muted">
                    {d.lastRun.status === 'running' ? 'Still running.' : runSummary(d.lastRun)}
                    {d.lastRun.status === 'partial' ? ' Some sources had problems.' : ''}
                    {d.lastRun.status === 'error' ? ` The check failed: ${d.lastRun.error}` : ''}
                  </span>
                </>
              ) : (
                'Not run yet. Press “Run now” to look for bids.'
              )}
            </dd>
          </div>
          <div>
            <dt>Next check</dt>
            <dd>
              {running
                ? 'Running now.'
                : d.nextRunAt
                  ? `${fmt.dateTime(d.nextRunAt)} (${fmt.relative(d.nextRunAt)})`
                  : d.mode === 'off'
                    ? 'Only when you press “Run now”.'
                    : 'Not scheduled.'}
            </dd>
          </div>
        </dl>
      </section>

      <ul className="tiles" aria-label="Counts">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link to={t.to} className={`tile ${t.tone ? `tile-${t.tone}` : ''}`}>
              <span className="tile-value">{t.value}</span>
              <span className="tile-label">{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      {setupLeft.length > 0 ? (
        <Section title="Finish setting up">
          <p className="muted">These steps make your submissions complete and let Lgbids send e-mail for you.</p>
          <ul className="setup-list">
            {d.setup.map((s) => (
              <li key={s.key} className={s.done ? 'done' : ''}>
                <span className="setup-mark" aria-hidden="true">
                  {s.done ? '✓' : '○'}
                </span>
                <span className="visually-hidden">{s.done ? 'Done: ' : 'To do: '}</span>
                {s.done ? <span>{s.label}</span> : <Link to={s.href}>{s.label}</Link>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="two-col">
        <Section title="Needs your attention">
          {d.attention.length === 0 ? (
            <Empty title="Nothing is waiting for you.">
              <p>When Lgbids drafts an application that needs your input or is ready to send, it appears here.</p>
            </Empty>
          ) : (
            <ul className="rows">
              {d.attention.map((a) => {
                const o = a.opportunity;
                const c = o ? fmt.closing(o.closesAt, o.closesAtPrecision, o.closesAtRaw) : null;
                return (
                  <li key={a.id} className="row">
                    <div className="row-main">
                      <Link to={`/applications/${a.id}`} className="row-title">
                        {o?.title ?? `Application ${a.id}`}
                      </Link>
                      <p className="row-meta">
                        {o?.organization}
                        {c ? (
                          <>
                            {' · '}
                            <span className={c.soon ? 'text-warn' : ''}>{c.relative}</span>
                          </>
                        ) : null}
                      </p>
                      {a.missing.length > 0 ? (
                        <ul className="missing-inline">
                          {a.missing.slice(0, 3).map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                          {a.missing.length > 3 ? <li>and {a.missing.length - 3} more</li> : null}
                        </ul>
                      ) : null}
                    </div>
                    <ApplicationChip status={a.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Upcoming deadlines">
          {d.deadlines.length === 0 ? (
            <Empty title="No deadlines coming up.">
              <p>
                Closing dates of suitable bids show here. You can also <a href="/api/calendar.ics">add them to your calendar</a>.
              </p>
            </Empty>
          ) : (
            <>
              <ul className="rows">
                {d.deadlines.map((o) => {
                  const c = fmt.closing(o.closesAt, o.closesAtPrecision, o.closesAtRaw);
                  return (
                    <li key={o.id} className="row">
                      <div className="row-main">
                        <Link to={`/opportunities/${o.id}`} className="row-title">
                          {o.title}
                        </Link>
                        <p className="row-meta">{o.organization}</p>
                      </div>
                      <div className="row-side">
                        <span className={c.soon ? 'text-warn strong' : 'strong'}>{c.relative}</span>
                        <span className="muted small">{c.absolute}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="small">
                <a href="/api/calendar.ics">Add closing dates to your calendar (.ics)</a>
              </p>
            </>
          )}
        </Section>
      </div>

      <Section title="Bid sites" actions={<Link to="/sources">Manage sources</Link>}>
        {failing.length > 0 ? (
          <Callout tone="bad" title={`${plural(failing.length, 'source')} could not be read on the last check.`}>
            <ul className="plain-list">
              {failing.map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong>: {s.lastMessage || 'No details were given.'}
                </li>
              ))}
            </ul>
            <p>
              Bids from {failing.length === 1 ? 'this site' : 'these sites'} may be missed until it is fixed.{' '}
              <Link to="/sources">Test the sources</Link>
            </p>
          </Callout>
        ) : d.counts.sourcesEnabled === 0 ? (
          <Callout tone="warn" title="No sources are turned on.">
            <p>
              Lgbids has nowhere to look for bids. <Link to="/sources">Turn on a source</Link>.
            </p>
          </Callout>
        ) : (
          <p>
            <span aria-hidden="true" className="text-good">
              ✓{' '}
            </span>
            All {plural(d.counts.sourcesEnabled, 'source')} that are turned on worked on the last check.
          </p>
        )}
        {d.sources.length > 0 ? (
          <ul className="source-mini">
            {d.sources
              .filter((s) => s.enabled)
              .map((s) => (
                <li key={s.id}>
                  <span className="source-mini-name">{s.name}</span>
                  <SourceChip status={s.lastStatus} />
                </li>
              ))}
          </ul>
        ) : null}
      </Section>
    </>
  );
}
