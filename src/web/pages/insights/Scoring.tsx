import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, FEEDBACK_CSV_URL } from '../../api.js';
import type { AutomationSettings, InsightBreakdown, InsightExample, InsightsDays, ScoringInsights, TuningSuggestion } from '../../../shared/schemas.js';
import { useFormat, useResource } from '../../hooks.js';
import { ConfirmDialog } from '../../components/Dialog.js';
import { Icon } from '../../components/Icon.js';
import { useToast } from '../../components/Toast.js';
import { Empty, ErrorBox, Section, SkeletonList } from '../../components/ui.js';

const WINDOWS: { key: string; label: string; days: InsightsDays }[] = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: 'all' },
];

const DECISION_TEXT = { suitable: 'Suitable', review: 'Needs review', unsuitable: 'Not suitable' } as const;

/** Tables scroll sideways inside their card on a phone instead of widening the page. */
function Scroll({ children }: { children: ReactNode }) {
  return <div style={{ overflowX: 'auto', maxWidth: '100%' }}>{children}</div>;
}

function Examples({ items }: { items: InsightExample[] }) {
  return (
    <>
      {items.map((e, i) => (
        <span key={e.feedbackId}>
          {i > 0 ? '; ' : ''}
          {e.opportunityId !== null ? <Link to={`/opportunities/${e.opportunityId}`}>{e.title}</Link> : e.title}
        </span>
      ))}
    </>
  );
}

function BreakdownTable({ title, caption, rows }: { title: string; caption: string; rows: InsightBreakdown[] }) {
  if (!rows.length) return null;
  return (
    <Section title={title}>
      <Scroll>
        <table className="table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Not relevant</th>
              <th scope="col">Missed</th>
              <th scope="col">Examples</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{r.notRelevant}</td>
                <td>{r.missed}</td>
                <td className="small">
                  <Examples items={r.examples} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </Section>
  );
}

/** Scoring tab (UX-10): what your feedback says about the scoring rules. Nothing changes unless you confirm it. */
export function ScoringTab() {
  const fmt = useFormat();
  const toast = useToast();
  const [windowKey, setWindowKey] = useState('30');
  const res = useResource<ScoringInsights>(`/api/insights/scoring?days=${windowKey}`);
  const automation = useResource<AutomationSettings>('/api/settings/automation');
  const [confirm, setConfirm] = useState<TuningSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const r = res.data;

  async function setExcluded(change: (words: string[]) => string[]): Promise<AutomationSettings> {
    // Read the latest settings first so nothing changed elsewhere is overwritten.
    const latest = await api.get<AutomationSettings>('/api/settings/automation');
    const saved = await api.put<AutomationSettings>('/api/settings/automation', { ...latest, excludeKeywords: change(latest.excludeKeywords) });
    automation.setData(saved);
    return saved;
  }

  async function addExcluded(word: string) {
    setBusy(true);
    try {
      await setExcluded((words) => (words.some((w) => w.toLowerCase() === word.toLowerCase()) ? words : [...words, word]));
      setConfirm(null);
      toast({
        text: `“${word}” was added to excluded words. Open bids are scored again at the next check.`,
        action: {
          label: 'Undo',
          run: () => {
            setExcluded((words) => words.filter((w) => w !== word)).then(
              () => toast({ text: `“${word}” was taken off excluded words.` }),
              (e: unknown) => toast({ ok: false, text: errorMessage(e) }),
            );
          },
        },
      });
    } catch (e) {
      toast({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <div className="toolbar">
      <label className="small">
        Look back{' '}
        <select value={windowKey} onChange={(e) => setWindowKey(e.target.value)}>
          {WINDOWS.map((w) => (
            <option key={w.key} value={w.key}>
              {w.label}
            </option>
          ))}
        </select>
      </label>
      <a className="btn btn-secondary btn-small" href={FEEDBACK_CSV_URL} download>
        <Icon name="download" size={16} /> Download feedback (CSV)
      </a>
    </div>
  );

  if (res.loading && !r) return <SkeletonList rows={3} label="Loading the scoring report…" />;
  if (res.error && !r) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!r) return null;
  if (r.counts.total === 0) {
    return (
      <>
        {picker}
        <Empty title="No feedback yet.">Mark a bid “Not relevant” to start.</Empty>
      </>
    );
  }

  const excluded = new Set((automation.data?.excludeKeywords ?? []).map((w) => w.toLowerCase()));
  const suggestions = r.suggestions.filter((s) => !(s.kind === 'exclude_keyword' && excluded.has(s.value.toLowerCase())));

  return (
    <>
      {picker}
      <Section title="Your feedback">
        <dl className="facts">
          <div>
            <dt>Items</dt>
            <dd>{r.counts.total}</dd>
          </div>
          <div>
            <dt>Not relevant</dt>
            <dd>{r.counts.notRelevant}</dd>
          </div>
          <div>
            <dt>Missed</dt>
            <dd>{r.counts.missed}</dd>
          </div>
          <div>
            <dt>Right under today’s rules</dt>
            <dd>
              {r.rescore.fixed} of {r.rescore.fixed + r.rescore.stillWrong}
            </dd>
          </div>
        </dl>
        <p className="muted small">
          Based on {r.counts.total} feedback {r.counts.total === 1 ? 'item' : 'items'}. Feedback never changes a score by itself.
        </p>
      </Section>

      {suggestions.length ? (
        <Section title="Suggestions">
          <p className="muted small">Each is backed by at least 3 bids, most of them marked not relevant. Nothing changes until you confirm.</p>
          <ul className="plain-list">
            {suggestions.map((s) => (
              <li key={`${s.kind}:${s.value}`}>
                {s.message}{' '}
                {s.kind === 'exclude_keyword' ? (
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => setConfirm(s)}>
                    Add “{s.value}” to excluded words
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {r.terms.length ? (
        <Section title="Words behind bids marked not relevant">
          <Scroll>
            <table className="table">
              <caption className="visually-hidden">Vocabulary terms that counted in bids you marked not relevant</caption>
              <thead>
                <tr>
                  <th scope="col">Term</th>
                  <th scope="col">Bids</th>
                  <th scope="col">Decisive</th>
                  <th scope="col">In the title</th>
                  <th scope="col">Examples</th>
                </tr>
              </thead>
              <tbody>
                {r.terms.map((t) => (
                  <tr key={t.term}>
                    <th scope="row">{t.term}</th>
                    <td>{t.falsePositives}</td>
                    <td>{t.decisive}</td>
                    <td>{t.inTitle}</td>
                    <td className="small">
                      <Examples items={t.examples} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Section>
      ) : null}

      <BreakdownTable title="By area" caption="Feedback by service-area result" rows={r.byArea} />
      <BreakdownTable title="By source" caption="Feedback by the site the bid came from" rows={r.bySource} />
      <BreakdownTable title="By notice type" caption="Feedback by notice type" rows={r.byNoticeType} />

      {r.missed.length ? (
        <Section title="Bids Lgbids missed">
          <ul className="plain-list">
            {r.missed.map((m) => (
              <li key={m.feedbackId}>
                {m.opportunityId !== null ? <Link to={`/opportunities/${m.opportunityId}`}>{m.title}</Link> : <strong>{m.title}</strong>}
                <span className="muted small">
                  {m.organization ? ` · ${m.organization}` : ''} · {m.decision ? `Scored ${DECISION_TEXT[m.decision]}` : 'Not scored'} · {fmt.date(m.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {r.uncovered.length ? (
            <p className="small">
              <strong>Words no rule covers:</strong> {r.uncovered.slice(0, 10).map((u) => `${u.ngram} (${u.count})`).join(', ')}.
            </p>
          ) : null}
        </Section>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title="Add to excluded words?"
        confirmLabel="Add to excluded words"
        busy={busy}
        onConfirm={() => {
          if (confirm) void addExcluded(confirm.value);
        }}
        onClose={() => setConfirm(null)}
      >
        <p>
          Lgbids will ignore notices that mention “{confirm?.value}”. Open bids are scored again with the new word at the next check. You can undo this here or
          in Settings.
        </p>
      </ConfirmDialog>
    </>
  );
}
