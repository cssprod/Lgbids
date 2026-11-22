import { useEffect, useState } from 'react';
import { PROTOTYPE } from '../prototypeFlag.js';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import type { DashboardResponse, RunState } from '../../shared/api.js';
import type { AutomationMode, RunRecord } from '../../shared/schemas.js';
import { useAction, useDocumentTitle, useFormat, useInterval, useResource } from '../hooks.js';
import { ApplicationChip, LayoutWarningCallout, SourceChip, TRIGGER_TEXT } from '../components/status.js';
import { Callout, Empty, ErrorBox, Live, PageHeader, Section, SkeletonList } from '../components/ui.js';
import { AwaitingResult } from '../components/dashboard/AwaitingResult.js';
import { ChangedChip } from '../components/opportunity/ChangedChip.js';
import { plural } from '../format.js';
import { Icon } from '../components/Icon.js';

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

  const [testing, setTesting] = useState<string | null>(null);
  async function testSource(id: string) {
    setTesting(id);
    try {
      await api.post(`/api/sources/${id}/test`);
    } catch {
      // The Sources page shows the details; Today just refreshes.
    } finally {
      setTesting(null);
      dash.reload();
    }
  }

  async function runNow() {
    const res = await run.run(() => api.post<RunState>('/api/runs'), 'Checking the bid sites now. This usually takes a minute or two.');
    if (res) setPolling(true);
  }

  if (dash.loading && !d) return <SkeletonList rows={6} label="Loading today’s overview…" />;
  if (dash.error && !d) return <ErrorBox message={dash.error} onRetry={dash.reload} />;
  if (!d) return null;

  const mode = MODE_TEXT[d.mode];
  const running = polling || d.running;
  // Optional steps are listed but never counted, so the card can finish without them.
  const required = d.setup.filter((s) => !s.optional);
  const setupLeft = required.filter((s) => !s.done);
  const warned = d.sources.filter((s) => s.enabled && s.layoutWarning !== '' && s.lastStatus !== 'error' && s.lastStatus !== 'blocked');
  const failing = d.sources.filter((s) => s.enabled && (s.lastStatus === 'error' || s.lastStatus === 'blocked'));
  const tiles: { label: string; value: number; to: string; tone?: string }[] = [
    { label: 'Suitable and open', value: d.counts.openSuitable, to: '/opportunities?view=suitable' },
    { label: 'Need a review', value: d.counts.review, to: '/opportunities?view=review' },
    { label: 'Need your input', value: d.counts.needsInput, to: '/applications', tone: d.counts.needsInput > 0 ? 'warn' : '' },
    { label: 'Ready to submit', value: d.counts.ready, to: '/applications', tone: d.counts.ready > 0 ? 'info' : '' },
    { label: 'Submitted', value: d.counts.submitted, to: '/applications' },
    { label: 'Closing within 7 days', value: d.counts.closingSoon, to: '/opportunities?view=suitable' },
  ];

  const setupDone = required.length - setupLeft.length;
  const isDone = (key: string) => d.setup.find((s) => s.key === key)?.done ?? false;
  // A brand-new install: show three clear first steps instead of empty counts and lists.
  const fresh = !d.lastRun && d.attention.length === 0 && d.counts.openSuitable === 0 && !d.demo;
  const alertSource = d.sources.find((s) => s.kind === 'email_alerts');
  const otherSources = d.sources.filter((s) => s.enabled && s.kind !== 'email_alerts');
  const attention = d.attention.slice(0, 5);
  const deadlines = d.deadlines.slice(0, 6);
  const needYou = d.counts.needsInput + d.counts.ready;
  // Changes the buyer made to bids (a moved date, an addendum) also need a look (MAT-15).
  const changed = d.counts.unseenChanges;
  const changedText = changed > 0 ? ` ${plural(changed, 'change')} to check.` : '';

  return (
    <>
      {d.demo && !PROTOTYPE ? (
        <div className="demo-banner" role="note">
          <strong>Demo mode</strong> — these are invented sample notices, not real opportunities. Nothing is sent to real buyers.
        </div>
      ) : null}
      <PageHeader
        title="Today"
        intro={
          fresh
            ? 'Welcome to Lgbids. Three steps below get your first bids in.'
            : needYou > 0
            ? `${plural(needYou, 'application')} ${needYou === 1 ? 'needs' : 'need'} you.${changedText} ${plural(d.counts.openSuitable, 'suitable bid')} open.`
            : changed > 0
            ? `${plural(changed, 'change')} to bids to check. ${plural(d.counts.openSuitable, 'suitable bid')} open.`
            : `Nothing is waiting for you. ${plural(d.counts.openSuitable, 'suitable bid')} open.`
        }
        actions={
          fresh ? undefined : (
          <button type="button" className="btn btn-primary" onClick={runNow} disabled={running || run.busy}>
            {running ? (
              <>
                <span className="spinner" aria-hidden="true" /> Checking…
              </>
            ) : (
              <>
                <Icon name="play" size={16} /> Run now
              </>
            )}
          </button>
          )
        }
      />
      <Live message={run.message} />

      <section className="card status-card" aria-labelledby="mode-title">
        <div className="status-mode">
          <p className="eyebrow">Automation</p>
          <h2 id="mode-title">{mode.title}</h2>
          <p className="muted">{mode.detail}</p>
          <Link to="/settings" className="small">
            Change automation settings
          </Link>
        </div>
        <dl className="status-facts">
          <div>
            <dt>
              <Icon name="clock" size={16} /> Last check
            </dt>
            <dd>
              {d.lastRun ? (
                <>
                  <span className="strong">{fmt.dateTime(d.lastRun.startedAt)}</span>{' '}
                  <span className="muted">({TRIGGER_TEXT[d.lastRun.trigger].toLowerCase()})</span>
                  <br />
                  <span className="muted small">
                    {d.lastRun.status === 'running' ? 'Still running.' : runSummary(d.lastRun)}
                    {d.lastRun.status === 'partial' ? ' Some sources had problems.' : ''}
                    {d.lastRun.status === 'error' ? ` The check failed: ${d.lastRun.error}` : ''}
                  </span>
                  <br />
                  <Link to="/activity" className="small">
                    See every check and what Lgbids did
                  </Link>
                </>
              ) : (
                'Not run yet.'
              )}
            </dd>
          </div>
          <div>
            <dt>
              <Icon name="calendar" size={16} /> Next check
            </dt>
            <dd>
              {running ? (
                'Running now.'
              ) : d.nextRunAt ? (
                <>
                  <span className="strong">{fmt.dateTime(d.nextRunAt)}</span> <span className="muted">({fmt.relative(d.nextRunAt)})</span>
                </>
              ) : d.mode === 'off' ? (
                'Only when you press “Run now”.'
              ) : (
                'Not scheduled.'
              )}
            </dd>
          </div>
        </dl>
      </section>

      {fresh ? (
        <Section title="Three steps to your first bids">
          <ol className="steps welcome-steps">
            <li className={isDone('profile') ? 'done' : ''}>
              <div>
                <p className="step-title">Fill in your company profile</p>
                <p className="small muted">Bids only ever state what you enter here: your company, insurance, services and references.</p>
              </div>
              <Link to="/profile" className={`btn ${isDone('profile') ? 'btn-secondary' : 'btn-primary'}`}>
                {isDone('profile') ? 'Review profile' : 'Open profile'}
              </Link>
            </li>
            <li className={isDone('alerts') ? 'done' : ''}>
              <div>
                <p className="step-title">Connect your bid alert inbox</p>
                <p className="small muted">BC Bid and Bonfire e-mail you new opportunities. Lgbids reads those e-mails from your Gmail, read-only.</p>
              </div>
              <Link to="/settings#alerts" className={`btn ${!isDone('profile') || isDone('alerts') ? 'btn-secondary' : 'btn-primary'}`}>
                {isDone('alerts') ? 'Connected' : 'Connect inbox'}
              </Link>
            </li>
            <li>
              <div>
                <p className="step-title">Run the first check</p>
                <p className="small muted">Lgbids reads your alerts and bid sites, scores each bid and drafts applications for your approval.</p>
              </div>
              <button type="button" className={`btn ${isDone('profile') && isDone('alerts') ? 'btn-primary' : 'btn-secondary'}`} onClick={runNow} disabled={running || run.busy}>
                <Icon name="play" size={16} /> Run first check
              </button>
            </li>
          </ol>
          <p className="small">
            <Link to="/settings#push">Optional: alerts on your phone</Link>
          </p>
        </Section>
      ) : null}

      {!fresh ? (
      <>
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
        <Section title="Finish setting up" actions={<span className="muted small">{setupDone} of {required.length} done</span>}>
          <div
            className="progress"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={required.length}
            aria-valuenow={setupDone}
          >
            <span style={{ width: `${(setupDone / Math.max(1, required.length)) * 100}%` }} />
          </div>
          <p className="muted">These steps make your submissions complete and let Lgbids send e-mail for you.</p>
          <ul className="setup-list">
            {d.setup.map((s) => (
              <li key={s.key} className={s.done ? 'done' : ''}>
                <span className="setup-mark" aria-hidden="true">
                  {s.done ? <Icon name="check" size={14} /> : null}
                </span>
                <span className="visually-hidden">{s.done ? 'Done: ' : 'To do: '}</span>
                {s.done ? <span>{s.label}</span> : <Link to={s.href}>{s.label}</Link>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="two-col">
        <Section
          title="Needs your attention"
          actions={d.attention.length > attention.length ? <Link to="/applications" className="small">See all {d.attention.length}</Link> : undefined}
        >
          {changed > 0 ? (
            <Callout tone="warn" title={`${plural(changed, 'change')} to bids since you last looked`}>
              <p>
                A buyer moved a date, added an addendum, cancelled or awarded a bid. Bids with a change show a “Changed” chip.{' '}
                <Link to="/opportunities?view=suitable">See the bids</Link>
              </p>
            </Callout>
          ) : null}
          {d.attention.length === 0 && changed === 0 ? (
            <Empty title="Nothing is waiting for you.">
              <p>When Lgbids drafts an application that needs your input or is ready to send, it appears here.</p>
            </Empty>
          ) : d.attention.length === 0 ? null : (
            <ul className="rows">
              {attention.map((a) => {
                const o = a.opportunity;
                const c = o ? fmt.closing(o.closesAt, o.closesAtPrecision, o.closesAtRaw) : null;
                return (
                  <li key={a.id} className="row">
                    <div className="row-main">
                      <Link to={`/applications/${a.id}`} className="row-title">
                        {o?.title ?? `Application ${a.id}`}
                      </Link>
                      <p className="row-meta">
                        <span>{o?.organization}</span>
                        {c ? <span className={c.soon ? 'text-warn strong' : ''}>{c.relative}</span> : null}
                        {o ? <ChangedChip opportunity={o} since={null} /> : null}
                      </p>
                      {a.missing.length > 0 ? (
                        <p className="missing-inline">
                          <span className="strong">Still needed:</span> {a.missing[0]}
                          {a.missing.length > 1 ? ` and ${plural(a.missing.length - 1, 'more item')}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <ApplicationChip status={a.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="Upcoming deadlines"
          actions={
            d.deadlines.length > 0 ? (
              <a href="/api/calendar.ics" className="small">
                Add to calendar
              </a>
            ) : undefined
          }
        >
          {d.deadlines.length === 0 ? (
            <Empty title="No deadlines coming up.">
              <p>
                Closing dates of suitable bids show here. You can also <a href="/api/calendar.ics">add them to your calendar</a>.
              </p>
            </Empty>
          ) : (
            <>
              <ul className="rows">
                {deadlines.map((o) => {
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
              {d.deadlines.length > deadlines.length ? (
                <p className="small">
                  <Link to="/opportunities?view=suitable">See all {d.deadlines.length} deadlines</Link>
                </p>
              ) : null}
            </>
          )}
        </Section>
      </div>

      </>
      ) : null}

      <AwaitingResult count={d.counts.awaitingResult} />

      <Section title="Where bids come from" actions={<Link to="/sources" className="small">Manage sources</Link>}>
        {alertSource ? (
          <div className={`alert-status ${alertSource.enabled && alertSource.lastStatus === 'ok' ? 'is-ok' : ''}`}>
            <Icon name="inbox" size={20} />
            <div>
              <p className="strong">Bid alert e-mails (BC Bid and Bonfire)</p>
              <p className="small muted">
                {!alertSource.enabled
                  ? 'Not set up. Most Greater Victoria landscaping bids arrive this way.'
                  : alertSource.lastRunAt
                    ? `${alertSource.lastMessage || 'Read on the last check.'}`
                    : 'Turned on. Alerts are read on the next check.'}
              </p>
            </div>
            {!alertSource.enabled ? (
              <Link to="/settings#alerts" className="btn btn-primary btn-small">
                Connect inbox
              </Link>
            ) : (
              <SourceChip status={alertSource.lastStatus} />
            )}
          </div>
        ) : null}
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
        ) : null}
        {warned.map((s) => (
          <LayoutWarningCallout key={s.id} name={s.name} warning={s.layoutWarning} url={s.config.url} onTest={() => void testSource(s.id)} testing={testing === s.id} />
        ))}
        {failing.length > 0 || d.counts.sourcesEnabled === 0 ? null : warned.length > 0 ? (
          <p className="small">
            <Link to="/sources">Check the sources</Link>
          </p>
        ) : otherSources.length > 0 && otherSources.every((s) => s.lastStatus === 'never') ? (
          <p className="muted">
            {plural(otherSources.length, 'bid site')} {otherSources.length === 1 ? 'is' : 'are'} turned on. {otherSources.length === 1 ? 'It is' : 'They are'} read on the first check.
          </p>
        ) : (
          <p className="ok-line">
            <span className="ok-dot" aria-hidden="true">
              <Icon name="check" size={14} />
            </span>
            All {plural(d.counts.sourcesEnabled, 'source')} that are turned on worked on the last check.
          </p>
        )}
        {otherSources.length > 0 ? (
          <details className="source-details" open={failing.length > 0}>
            <summary>Show each bid site</summary>
            <ul className="source-mini">
              {otherSources.map((s) => (
                  <li key={s.id}>
                    <span className="source-mini-name">{s.name}</span>
                    <SourceChip status={s.lastStatus} warning={s.layoutWarning !== ''} />
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
      </Section>
    </>
  );
}
