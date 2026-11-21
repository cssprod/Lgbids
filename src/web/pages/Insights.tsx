import { useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from '../hooks.js';
import { PageHeader } from '../components/ui.js';
import { ScoringTab } from './insights/Scoring.js';
import { ResultsTab } from './insights/Results.js';

const TABS = [
  { key: 'scoring', label: 'Scoring' },
  { key: 'results', label: 'Results' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** Insights (D20): how well the scoring works, and your win/loss record. */
export function InsightsPage() {
  useDocumentTitle('Insights');
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('tab') === 'results' ? 'results' : 'scoring';

  return (
    <>
      <PageHeader title="Insights" intro="How well Lgbids scores bids for you, and how your bids turned out." />
      <div className="toolbar">
        <nav aria-label="Insights" className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="tab"
              aria-current={t.key === tab ? 'page' : undefined}
              onClick={() => setParams(t.key === 'scoring' ? {} : { tab: t.key }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {tab === 'scoring' ? <ScoringTab /> : <ResultsTab />}
    </>
  );
}
