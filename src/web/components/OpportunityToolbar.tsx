import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { createSavedSearch, deleteSavedSearch, errorMessage, updateSavedSearch } from '../api.js';
import type { OpportunityViewName } from '../../shared/api.js';
import { SERVICE_KEYS, SERVICE_LABELS, type OpportunityFilterInput, type SavedSearch, type ServiceKey } from '../../shared/schemas.js';
import { useResource } from '../hooks.js';
import { ConfirmDialog, Dialog } from './Dialog.js';
import { Field } from './ui.js';
import { useToast } from './Toast.js';

const VIEW_KEYS: OpportunityViewName[] = ['suitable', 'review', 'unsuitable', 'closed', 'dismissed', 'all'];
const CLOSING_DAYS = [7, 14, 30];
export const SCORE_STEPS = [50, 60, 70, 80];

export const DEFAULT_FILTER: OpportunityFilterInput = {
  view: 'suitable',
  q: '',
  sourceId: '',
  closingWithinDays: null,
  minScore: null,
  service: null,
  place: '',
};

/** The list filters as kept in the page URL (short keys, as in v1: `closing`, `source`). */
export function filterFromParams(params: URLSearchParams): OpportunityFilterInput {
  const view = params.get('view');
  const closing = Number(params.get('closing'));
  const score = params.get('minScore');
  const service = params.get('service');
  return {
    view: VIEW_KEYS.includes(view as OpportunityViewName) ? (view as OpportunityViewName) : 'suitable',
    q: (params.get('q') ?? '').trim(),
    sourceId: params.get('source') ?? '',
    closingWithinDays: CLOSING_DAYS.includes(closing) ? closing : null,
    minScore: score !== null && /^\d{1,3}$/.test(score) && Number(score) <= 100 ? Number(score) : null,
    service: (SERVICE_KEYS as readonly string[]).includes(service ?? '') ? (service as ServiceKey) : null,
    place: (params.get('place') ?? '').trim().slice(0, 80),
  };
}

/** The page URL for a filter (a saved search's link). */
export function paramsFromFilter(f: OpportunityFilterInput): URLSearchParams {
  const p = new URLSearchParams({ view: f.view });
  if (f.q) p.set('q', f.q);
  if (f.closingWithinDays) p.set('closing', String(f.closingWithinDays));
  if (f.sourceId) p.set('source', f.sourceId);
  if (f.minScore !== null) p.set('minScore', String(f.minScore));
  if (f.service) p.set('service', f.service);
  if (f.place) p.set('place', f.place);
  return p;
}

/** The API query for a filter; the list and the CSV take the same one. */
export function apiQuery(f: OpportunityFilterInput, extra: Record<string, string> = {}): URLSearchParams {
  const p = new URLSearchParams({ view: f.view, ...extra });
  if (f.q) p.set('q', f.q);
  if (f.closingWithinDays) p.set('closingWithinDays', String(f.closingWithinDays));
  if (f.sourceId) p.set('sourceId', f.sourceId);
  if (f.minScore !== null) p.set('minScore', String(f.minScore));
  if (f.service) p.set('service', f.service);
  if (f.place) p.set('place', f.place);
  return p;
}

export function sameFilter(a: OpportunityFilterInput, b: OpportunityFilterInput): boolean {
  return paramsFromFilter(a).toString() === paramsFromFilter(b).toString();
}

/** Score, kind of work and place (UX-13). Changes go to the URL through `onChange`. */
export function MoreFilters({ filter, onChange }: { filter: OpportunityFilterInput; onChange: (key: 'minScore' | 'service' | 'place', value: string) => void }) {
  const scoreId = useId();
  const serviceId = useId();
  const placeId = useId();
  const [place, setPlace] = useState(filter.place);
  useEffect(() => setPlace(filter.place), [filter.place]);
  // Like the search box: apply the place after a short pause in typing.
  useEffect(() => {
    if (place.trim() === filter.place) return;
    const t = setTimeout(() => onChange('place', place.trim()), 350);
    return () => clearTimeout(t);
  }, [place, filter.place, onChange]);

  return (
    <>
      <label htmlFor={scoreId} className="visually-hidden">
        Lowest score
      </label>
      <select id={scoreId} value={filter.minScore ?? ''} onChange={(e) => onChange('minScore', e.target.value)}>
        <option value="">Any score</option>
        {SCORE_STEPS.map((n) => (
          <option key={n} value={n}>
            Score {n} or more
          </option>
        ))}
      </select>
      <label htmlFor={serviceId} className="visually-hidden">
        Kind of work
      </label>
      <select id={serviceId} value={filter.service ?? ''} onChange={(e) => onChange('service', e.target.value)}>
        <option value="">Any kind of work</option>
        {SERVICE_KEYS.map((k) => (
          <option key={k} value={k}>
            {SERVICE_LABELS[k]}
          </option>
        ))}
      </select>
      <label htmlFor={placeId} className="visually-hidden">
        Place
      </label>
      <input id={placeId} type="search" value={place} maxLength={80} placeholder="Place, e.g. Saanich" onChange={(e) => setPlace(e.target.value)} />
    </>
  );
}

/** "Your searches": links above the tabs, "Save this search", rename and delete. */
export function SavedSearches({ filter }: { filter: OpportunityFilterInput }) {
  const res = useResource<SavedSearch[]>('/api/saved-searches');
  const toast = useToast();
  const [naming, setNaming] = useState<{ mode: 'save' } | { mode: 'rename'; search: SavedSearch } | null>(null);
  const [deleting, setDeleting] = useState<SavedSearch | null>(null);
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const searches = res.data ?? [];
  const canSave = !sameFilter(filter, DEFAULT_FILTER) && !searches.some((s) => sameFilter(s.filter, filter));

  async function remove(s: SavedSearch) {
    setBusy(true);
    try {
      await deleteSavedSearch(s.id);
      toast({ text: `The search “${s.name}” was deleted.` });
      setDeleting(null);
      res.reload();
    } catch (e) {
      toast({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="saved-searches">
      {searches.length > 0 ? (
        <nav aria-label="Your searches" className="button-row">
          <span className="muted small">Your searches:</span>
          {searches.map((s) => (
            <Link key={s.id} to={`/opportunities?${paramsFromFilter(s.filter)}`} className={`btn btn-small ${sameFilter(s.filter, filter) ? 'btn-secondary' : 'btn-ghost'}`} aria-current={sameFilter(s.filter, filter) ? 'page' : undefined}>
              {s.name}
            </Link>
          ))}
          <button type="button" className="btn btn-small btn-ghost" aria-expanded={managing} onClick={() => setManaging((m) => !m)}>
            {managing ? 'Done' : 'Manage'}
          </button>
        </nav>
      ) : null}
      {managing && searches.length > 0 ? (
        <ul className="stack-list">
          {searches.map((s) => (
            <li key={s.id} className="button-row">
              <span>{s.name}</span>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => setNaming({ mode: 'rename', search: s })}>
                Rename<span className="visually-hidden"> {s.name}</span>
              </button>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setDeleting(s)}>
                Delete<span className="visually-hidden"> {s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        <button
          type="button"
          className="btn btn-small btn-secondary"
          disabled={!canSave}
          title={canSave ? 'Keep these filters under a name.' : 'Change a filter first; this view is the default or already saved.'}
          onClick={() => setNaming({ mode: 'save' })}
        >
          Save this search
        </button>
      </p>
      {naming ? (
        <NameDialog
          title={naming.mode === 'save' ? 'Save this search' : 'Rename search'}
          initial={naming.mode === 'rename' ? naming.search.name : ''}
          onClose={() => setNaming(null)}
          onSave={async (name) => {
            if (naming.mode === 'save') await createSavedSearch({ name, filter });
            else await updateSavedSearch(naming.search.id, { name });
            toast({ text: naming.mode === 'save' ? `The search “${name}” was saved.` : `The search is now called “${name}”.` });
            setNaming(null);
            res.reload();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        title={deleting ? `Delete “${deleting.name}”?` : 'Delete search?'}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => deleting && void remove(deleting)}
        onClose={() => setDeleting(null)}
      >
        <p>The saved search “{deleting?.name}” is removed. The bids it found are not changed.</p>
      </ConfirmDialog>
    </div>
  );
}

function NameDialog({ title, initial, onClose, onSave }: { title: string; initial: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const formId = useId();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name for this search.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSave(trimmed);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Name" hint="Up to 60 characters, different from your other searches." error={error}>
          <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
