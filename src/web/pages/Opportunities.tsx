import { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api.js';
import type { OpportunityList, OpportunityViewName } from '../../shared/api.js';
import type { Opportunity, SourceRecord } from '../../shared/schemas.js';
import { NOTICE_TYPE_LABELS, SUBMISSION_METHOD_LABELS } from '../../shared/schemas.js';
import { isNewSince, lastVisit, useDocumentTitle, useFormat, useResource } from '../hooks.js';
import { ApplicationChip, DecisionChip, ScoreWithReasons } from '../components/status.js';
import { Term } from '../components/Popover.js';
import { Chip, Empty, ErrorBox, PageHeader, SkeletonList } from '../components/ui.js';
import { Icon } from '../components/Icon.js';
import { useToast } from '../components/Toast.js';

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
  const closing = ['7', '14', '30'].includes(params.get('closing') ?? '') ? params.get('closing')! : '';
  const sourceId = params.get('source') ?? '';
  const sources = useResource<SourceRecord[]>('/api/sources');
  const since = lastVisit();
  const closingId = useId();
  const sourceSelectId = useId();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
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
    if (closing) qs.set('closingWithinDays', closing);
    if (sourceId) qs.set('sourceId', sourceId);
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
  }, [view, q, closing, sourceId, nonce]);

  async function loadMore() {
    if (!list) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ view, limit: String(PAGE), offset: String(list.items.length) });
      if (q) qs.set('q', q);
      if (closing) qs.set('closingWithinDays', closing);
      if (sourceId) qs.set('sourceId', sourceId);
      const more = await api.get<OpportunityList>(`/api/opportunities?${qs}`);
      setList({ ...more, items: [...list.items, ...more.items] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  // The export takes the same filters as the list on screen.
  const csvQuery = (() => {
    const qs = new URLSearchParams({ view });
    if (q) qs.set('q', q);
    if (closing) qs.set('closingWithinDays', closing);
    if (sourceId) qs.set('sourceId', sourceId);
    return qs.toString();
  })();

  function setView(v: OpportunityViewName) {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next);
  }

  return (
    <>
      <PageHeader
        title="Opportunities"
        intro={<p>Bids found on your sources, scored for your company.</p>}
        actions={
          <a className="btn btn-secondary" href={`/api/opportunities.csv?${csvQuery}`} download title="Download this list, with the current filters, as a spreadsheet file.">
            <Icon name="download" size={16} /> Download CSV
          </a>
        }
      />
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
          <Icon name="search" size={16} className="search-icon" />
          <input
            id={searchId}
            type="search"
            value={search}
            placeholder="Search title, buyer or reference"
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        <div className="filters">
          <label htmlFor={closingId} className="visually-hidden">
            Closing
          </label>
          <select id={closingId} value={closing} onChange={(e) => setParam('closing', e.target.value)}>
            <option value="">Any closing date</option>
            <option value="7">Closing within a week</option>
            <option value="14">Closing within 2 weeks</option>
            <option value="30">Closing within 30 days</option>
          </select>
          <label htmlFor={sourceSelectId} className="visually-hidden">
            Found on
          </label>
          <select id={sourceSelectId} value={sourceId} onChange={(e) => setParam('source', e.target.value)}>
            <option value="">All sources</option>
            {(sources.data ?? [])
              .filter((s) => s.enabled || s.id === sourceId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {error ? <ErrorBox message={error} onRetry={() => setNonce((n) => n + 1)} /> : null}
      {loading && !list ? <SkeletonList rows={5} label="Loading opportunities…" /> : null}
      {list && !error ? (
        <div aria-busy={loading}>
          <p className="muted small" aria-live="polite">
            {q ? `${list.total} matching “${q}”.` : `${list.total} in this list.`}
            {(() => {
              const n = list.items.filter((o) => isNewSince(o.firstSeenAt, since)).length;
              return n > 0 ? ` ${n} new since your last visit.` : '';
            })()}
          </p>
          {list.items.length === 0 ? (
            <Empty title={q || closing || sourceId ? 'Nothing matches these filters.' : 'Nothing here yet.'}>
              <p>{q || closing || sourceId ? 'Try a shorter word, a wider closing window or all sources.' : EMPTY_TEXT[view]}</p>
            </Empty>
          ) : (
            <ul className="opp-list list-card">
              {list.items.map((o) => (
                <OpportunityRow key={o.id} o={o} isNew={isNewSince(o.firstSeenAt, since)} onChanged={() => setNonce((n) => n + 1)} />
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

function OpportunityRow({ o, isNew, onChanged }: { o: Opportunity; isNew: boolean; onChanged: () => void }) {
  const fmt = useFormat();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const canDecide = o.status === 'open' && !o.application && !o.userDecision && (o.decision === 'suitable' || o.decision === 'review');

  async function decide(decision: 'pursue' | 'dismissed') {
    setBusy(true);
    try {
      const updated = await api.post<Opportunity>(`/api/opportunities/${o.id}/decision`, { decision });
      if (decision === 'pursue') {
        const appId = updated.application?.id;
        toast({
          text: `Application drafted for “${o.title}”.`,
          action: appId ? { label: 'Open', run: () => navigate(`/applications/${appId}`) } : undefined,
        });
      } else {
        toast({
          text: `“${o.title}” is dismissed.`,
          action: {
            label: 'Undo',
            run: () => {
              api.post(`/api/opportunities/${o.id}/decision`, { decision: null }).then(onChanged, (e: unknown) => toast({ ok: false, text: errorMessage(e) }));
            },
          },
        });
      }
      onChanged();
    } catch (e) {
      toast({ ok: false, text: errorMessage(e) });
      setBusy(false);
    }
  }
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
          <Term name={NOTICE_TYPE_LABELS[o.noticeType]}>{NOTICE_TYPE_LABELS[o.noticeType]}</Term>
          {o.referenceNumber ? ` · ${o.referenceNumber}` : ''}
        </p>
        <p className="opp-tags">
          {isNew ? (
            <Chip tone="info" symbol="•">
              New
            </Chip>
          ) : null}
          <DecisionChip decision={o.decision} userDecision={o.userDecision} />
          {o.application ? <ApplicationChip status={o.application.status} /> : null}
          <span className="how">
            <Icon name={o.submissionMethod === 'email' ? 'send' : o.submissionMethod === 'unknown' ? 'alert' : 'upload'} size={14} />
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
        <ScoreWithReasons score={o.suitabilityScore} reasons={o.analysis?.reasons ?? []} />
      </div>
      {canDecide ? (
        <div className="opp-actions">
          <button type="button" className="btn btn-small btn-secondary" disabled={busy} onClick={() => decide('pursue')}>
            Pursue<span className="visually-hidden"> {o.title}</span>
          </button>
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => decide('dismissed')}>
            Not for us<span className="visually-hidden">: {o.title}</span>
          </button>
        </div>
      ) : null}
    </li>
  );
}
