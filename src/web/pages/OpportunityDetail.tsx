import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { Opportunity, Requirement, UserDecision } from '../../shared/schemas.js';
import { NOTICE_TYPE_LABELS, SERVICE_LABELS, SUBMISSION_METHOD_LABELS } from '../../shared/schemas.js';
import { useAction, useDocumentTitle, useFormat, useResource } from '../hooks.js';
import { ApplicationChip, DecisionChip, ReasonList, ScoreBadge } from '../components/status.js';
import { Icon } from '../components/Icon.js';
import { Term } from '../components/Popover.js';
import { BackLink, Callout, ErrorBox, ExternalLink, Live, Loading, PlainText, Section } from '../components/ui.js';
import { AlertsToggle } from '../components/opportunity/AlertsToggle.js';
import { AwardSection } from '../components/opportunity/AwardSection.js';
import { ChangesSection } from '../components/opportunity/ChangesSection.js';
import { FeedbackButtons } from '../components/opportunity/FeedbackButtons.js';

function RequirementRow({ r }: { r: Requirement }) {
  const [cls, symbol, text] =
    r.met === true ? ['good', '✓', 'Met'] : r.met === false ? ['bad', '✕', 'Not met'] : ['warn', '?', 'Check'];
  return (
    <li className={`req req-${cls}`}>
      <span className={`chip chip-${cls}`}>
        <span className="chip-symbol" aria-hidden="true">
          {symbol}
        </span>
        {text}
      </span>
      <span>
        <Term name={r.key}>
          <strong>{r.label}</strong>
        </Term>
        {r.detail ? <span className="muted"> — {r.detail}</span> : null}
      </span>
    </li>
  );
}

export function OpportunityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fmt = useFormat();
  const res = useResource<Opportunity>(`/api/opportunities/${id ?? ''}`);
  const action = useAction();
  const o = res.data;
  useDocumentTitle(o?.title ?? 'Opportunity');

  async function decide(decision: UserDecision, message: string) {
    const updated = await action.run(() => api.post<Opportunity>(`/api/opportunities/${id}/decision`, { decision }), message);
    if (!updated) return;
    res.setData(updated);
    if (decision === 'pursue' && updated.application) navigate(`/applications/${updated.application.id}`);
  }

  if (res.loading && !o) return <Loading />;
  if (res.error && !o) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!o) return null;

  const c = fmt.closing(o.closesAt, o.closesAtPrecision, o.closesAtRaw);
  const a = o.analysis;
  const isOpen = o.status === 'open' && !c.past;

  return (
    <>
      <BackLink to="/opportunities">All opportunities</BackLink>
      <header className="page-header detail-header">
        <div>
          <p className="eyebrow">
            <Term name={NOTICE_TYPE_LABELS[o.noticeType]}>{NOTICE_TYPE_LABELS[o.noticeType]}</Term>
          </p>
          <h1>{o.title}</h1>
          <p className="lead">
            {o.organization || 'Buyer not stated'}
            {o.referenceNumber ? <span className="muted"> · Reference {o.referenceNumber}</span> : null}
          </p>
          <p className="opp-tags">
            <DecisionChip decision={o.decision} userDecision={o.userDecision} />
            {o.application ? <ApplicationChip status={o.application.status} /> : null}
            {o.status !== 'open' ? <span className="chip chip-neutral">{statusText(o.status)}</span> : null}
          </p>
        </div>
        <div className="detail-score">
          <ScoreBadge score={o.suitabilityScore} />
          <span className="muted small">Suitability</span>
        </div>
      </header>

      {o.duplicateOf ? (
        <Callout tone="info" title="This notice is also listed elsewhere.">
          <p>
            Lgbids treats it as a copy of <Link to={`/opportunities/${o.duplicateOf}`}>another listing</Link> so you only work on it once.
          </p>
        </Callout>
      ) : null}

      <div className="actions-bar">
        {o.application ? (
          <Link to={`/applications/${o.application.id}`} className="btn btn-primary">
            Open the application
          </Link>
        ) : isOpen && o.userDecision !== 'dismissed' ? (
          <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => decide('pursue', 'Application drafted.')}>
            Pursue — draft an application
          </button>
        ) : null}
        {o.userDecision !== 'dismissed' && !o.application ? (
          <button type="button" className="btn btn-secondary" disabled={action.busy} onClick={() => decide('dismissed', 'Marked as not for us. It will no longer show in your lists.')}>
            Not for us
          </button>
        ) : null}
        {o.userDecision ? (
          <button type="button" className="btn btn-ghost" disabled={action.busy} onClick={() => decide(null, 'Your decision was undone.')}>
            Undo my decision
          </button>
        ) : null}
        {o.url ? (
          <ExternalLink href={o.url} className="btn btn-ghost">
            Original notice
          </ExternalLink>
        ) : null}
        {o.closesAt && isOpen ? (
          <a className="btn btn-ghost" href={`/api/calendar.ics?id=${o.id}`}>
            <Icon name="calendar" size={16} /> Add to calendar
          </a>
        ) : null}
      </div>
      <Live message={action.message} />
      <AlertsToggle opportunity={o} onChange={res.setData} />

      <div className="detail-grid">
        <div className="detail-main">
          <ChangesSection opportunity={o} onChange={res.setData} />
          <Section title="Why this score">
            {a ? <ReasonList reasons={a.reasons} /> : <p className="muted">This notice has not been scored yet.</p>}
            {a && a.services.length > 0 ? (
              <p className="small">
                <strong>Work involved:</strong> {a.services.map((s) => SERVICE_LABELS[s]).join(', ')}
              </p>
            ) : null}
            <FeedbackButtons opportunity={o} onChange={res.setData} />
          </Section>

          <AwardSection opportunity={o} onChange={res.reload} />

          <Section title="Requirements">
            {a && a.requirements.length > 0 ? (
              <>
                <p className="muted small">Compared with your company profile. “Check” means Lgbids could not tell; read the documents.</p>
                <ul className="reqs">
                  {a.requirements.map((r) => (
                    <RequirementRow key={r.key} r={r} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">No special requirements were found in the notice. Always read the bid documents before submitting.</p>
            )}
          </Section>

          <Section title="Description">
            <PlainText text={o.description} />
          </Section>
        </div>

        <aside className="detail-side" aria-label="Key facts">
          <Section title="Key facts">
            <dl className="facts">
              <div>
                <dt>Closes</dt>
                <dd>
                  <span className={c.soon ? 'text-warn strong' : 'strong'}>{c.relative}</span>
                  <br />
                  {c.absolute}
                </dd>
              </div>
              <div>
                <dt>How to submit</dt>
                <dd>
                  {SUBMISSION_METHOD_LABELS[o.submissionMethod]}
                  {o.submissionEmail ? (
                    <>
                      <br />
                      <a href={`mailto:${o.submissionEmail}`}>{o.submissionEmail}</a>
                    </>
                  ) : null}
                  {o.submissionUrl ? (
                    <>
                      <br />
                      <ExternalLink href={o.submissionUrl}>Submission page</ExternalLink>
                    </>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {o.location || 'Not stated'}
                  {a ? <span className="muted small"> ({areaText(a.area, a.areaMatch)})</span> : null}
                </dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{o.publishedAt ? fmt.date(o.publishedAt) : 'Not stated'}</dd>
              </div>
              <div>
                <dt>Found on</dt>
                <dd>
                  {o.sourceName}, first seen {fmt.date(o.firstSeenAt)}
                </dd>
              </div>
              {a && a.alsoListed.length > 0 ? (
                <div>
                  <dt>Also listed on</dt>
                  <dd>
                    <ul className="plain-list">
                      {a.alsoListed.map((l) => (
                        <li key={l.url}>
                          <ExternalLink href={l.url}>{l.source}</ExternalLink>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </dl>
          </Section>

          <Section title="Contact">
            {o.contactName || o.contactEmail || o.contactPhone ? (
              <dl className="facts">
                {o.contactName ? (
                  <div>
                    <dt>Name</dt>
                    <dd>{o.contactName}</dd>
                  </div>
                ) : null}
                {o.contactEmail ? (
                  <div>
                    <dt>E-mail</dt>
                    <dd>
                      <a href={`mailto:${o.contactEmail}`}>{o.contactEmail}</a>
                    </dd>
                  </div>
                ) : null}
                {o.contactPhone ? (
                  <div>
                    <dt>Phone</dt>
                    <dd>
                      <a href={`tel:${o.contactPhone.replace(/[^\d+]/g, '')}`}>{o.contactPhone}</a>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="muted">No contact was listed. The bid documents usually name one.</p>
            )}
          </Section>

          <Section title="Documents">
            {o.documents.length > 0 ? (
              <ul className="plain-list doc-links">
                {o.documents.map((d) => (
                  <li key={d.url}>
                    <ExternalLink href={d.url}>{d.name || 'Document'}</ExternalLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No documents were linked. Open the original notice to find them.</p>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}

function statusText(s: Opportunity['status']): string {
  return { open: 'Open', closed: 'Closed', cancelled: 'Cancelled', awarded: 'Awarded' }[s];
}

function areaText(area: 'yes' | 'no' | 'unknown', match: string): string {
  if (area === 'yes') return match ? `in your service area: ${match}` : 'in your service area';
  if (area === 'no') return match ? `outside your service area: ${match}` : 'outside your service area';
  return 'service area unclear';
}
