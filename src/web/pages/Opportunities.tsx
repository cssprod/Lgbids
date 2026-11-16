import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api.js';
import type { OpportunityList, OpportunityViewName } from '../../shared/api.js';
import type { Opportunity } from '../../shared/schemas.js';
import { NOTICE_TYPE_LABELS, SUBMISSION_METHOD_LABELS } from '../../shared/schemas.js';
import { useDocumentTitle, useFormat } from '../hooks.js';
import { ApplicationChip, DecisionChip, ScoreBadge } from '../components/status.js';
import { Empty, ErrorBox, Loading, PageHeader } from '../components/ui.js';

const VIEWS: { key: OpportunityViewName; label: string }[] = [
  { key: 'suitable', label: 'Suitable' },
  { key: 'review', label: 'Review' },
  { key: 'unsuitable', label: 'Not suitable' },
  { key: 'closed', label: 'Closed' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

const EMPTY_TEXT: Record<OpportunityViewName, string> = {
  suitable: 'No suitable open bids right now. Lgbids keeps looking; press “Run now” on the Today screen to check straight away.',
  review: 'Nothing needs a review. Bids that might fit but need your judgement show here.',
  unsuitable: 'No bids have been ruled out yet.',
  closed: 'No closed bids yet. Bids move here once their closing time has passed.',
  dismissed: 'You have not dismissed any bids.',
  all: 'No bids have been found yet. Check that your sources are turned on, then press “Run now” on the Today screen.',
};

const PAGE = 50;

function isView(v: string | null): v is OpportunityViewName {
  return VIEWS.some((x) => x.key === v);
}

export function OpportunitiesPage() {
  useDocumentTitle('Opportunities');
  const [params, setParams] = useSearchParams();
  const view: OpportunityViewName = isView(params.get('view')) ? (params.get('view') as OpportunityViewName) : 'suitable';
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const [list, setList] = useState<OpportunityList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0);
  const searchId = useId();

  // Search as the user types, after a short pause.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() === q) return;
      const next = new URLSearchParams(params);
      if (search.trim()) next.set('q', search.trim());
      else next.delete('q');
      setParams(next, { replace: true });
    }, 350);
    return () => clearTimeout(t);
  }, [search, q, params, setParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ view, limit: String(PAGE), offset: '0' });
    if (q) qs.set('q', q);
    api.get<OpportunityList>(`/api/opportunities?${qs}`).then(
      (l) => {
        if (!cancelled) {
          setList(l);
          setLoading(false);
        }
      },
      (e: unknown) => {
        if (!cancelled) {
          setError(errorMessage(e));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [view, q, nonce]);

  async function loadMore() {
    if (!list) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ view, limit: String(PAGE), offset: String(list.items.length) });
      if (q) qs.set('q', q);
      const more = await api.get<OpportunityList>(`/api/opportunities?${qs}`);
      setList({ ...more, items: [...list.items, ...more.items] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function setView(v: OpportunityViewName) {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next);
  }

  return (
    <>
      <PageHeader title="Opportunities" intro={<p>Bids found on your sources, scored for your company.</p>} />
      <div className="toolbar">
        <nav aria-label="Filter opportunities" className="tabs">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className="tab"
              aria-current={v.key === view ? 'page' : undefined}
              onClick={() => setView(v.key)}
            >
              {v.label}
              {list ? <span className="tab-count">{list.counts[v.key]}</span> : null}
            </button>
          ))}
        </nav>
        <form
          role="search"
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <label htmlFor={searchId} className="visually-hidden">
            Search opportunities
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            placeholder="Search title, buyer or reference"
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
      </div>

      {error ? <ErrorBox message={error} onRetry={() => setNonce((n) => n + 1)} /> : null}
      {loading && !list ? <Loading /> : null}
      {list && !error ? (
        <div aria-busy={loading}>
          <p className="muted small" aria-live="polite">
            {q ? `${list.total} matching “${q}”.` : `${list.total} in this list.`}
          </p>
          {list.items.length === 0 ? (
            <Empty title={q ? 'Nothing matches your search.' : 'Nothing here yet.'}>
              <p>{q ? 'Try a shorter word, or look in the “All” tab.' : EMPTY_TEXT[view]}</p>
            </Empty>
          ) : (
            <ul className="opp-list">
              {list.items.map((o) => (
                <OpportunityRow key={o.id} o={o} />
              ))}
            </ul>
          )}
          {list.items.length < list.total ? (
            <p>
              <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Show more (${list.total - list.items.length} left)`}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function OpportunityRow({ o }: { o: Opportunity }) {
  const fmt = useFormat();
  const c = fmt.closing(o.closesAt, o.closesAtPrecision, o.closesAtRaw);
  return (
    <li className="opp-row">
      <div className="opp-main">
        <Link to={`/opportunities/${o.id}`} className="row-title">
          {o.title}
        </Link>
        <p className="row-meta">
          {o.organization || 'Buyer not stated'}
          {' · '}
          {NOTICE_TYPE_LABELS[o.noticeType]}
          {o.referenceNumber ? ` · ${o.referenceNumber}` : ''}
        </p>
        <p className="opp-tags">
          <DecisionChip decision={o.decision} userDecision={o.userDecision} />
          {o.application ? <ApplicationChip status={o.application.status} /> : null}
          <span className="how">
            <span className="visually-hidden">How to submit: </span>
            {SUBMISSION_METHOD_LABELS[o.submissionMethod]}
          </span>
        </p>
      </div>
      <div className="opp-closing">
        <span className={c.past ? 'muted' : c.soon ? 'text-warn strong' : 'strong'}>{c.relative}</span>
        <span className="muted small">{c.absolute}</span>
      </div>
      <div className="opp-score">
        <ScoreBadge score={o.suitabilityScore} />
      </div>
    </li>
  );
}
