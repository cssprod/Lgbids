import { APPLICATION_STATUS_LABELS } from '../../shared/schemas.js';
import type { ApplicationStatus, Decision, RunRecord, SourceStatus, UserDecision, AnalysisReason } from '../../shared/schemas.js';
import { Chip, type Tone } from './ui.js';
import { Popover } from './Popover.js';

const APP_TONE: Record<ApplicationStatus, [Tone, string]> = {
  needs_input: ['warn', '!'],
  ready: ['info', '●'],
  sending: ['info', '…'],
  submitted: ['good', '✓'],
  failed: ['bad', '✕'],
  expired: ['neutral', '–'],
  withdrawn: ['neutral', '–'],
  won: ['good', '★'],
  lost: ['neutral', '○'],
};

export function ApplicationChip({ status }: { status: ApplicationStatus }) {
  const [tone, symbol] = APP_TONE[status];
  return (
    <Chip tone={tone} symbol={symbol}>
      {APPLICATION_STATUS_LABELS[status]}
    </Chip>
  );
}

export const SOURCE_STATUS_TEXT: Record<SourceStatus, [Tone, string, string]> = {
  ok: ['good', '✓', 'Working'],
  empty: ['warn', '○', 'Working, nothing listed'],
  error: ['bad', '✕', 'Failing'],
  blocked: ['bad', '✕', 'Blocked by the site'],
  never: ['neutral', '–', 'Not checked yet'],
};

export function SourceChip({ status }: { status: SourceStatus }) {
  const [tone, symbol, text] = SOURCE_STATUS_TEXT[status];
  return (
    <Chip tone={tone} symbol={symbol}>
      {text}
    </Chip>
  );
}

export function DecisionChip({ decision, userDecision }: { decision: Decision | null; userDecision?: UserDecision }) {
  if (userDecision === 'dismissed') return <Chip tone="neutral" symbol="–">Dismissed</Chip>;
  if (userDecision === 'pursue') return <Chip tone="good" symbol="★">Pursuing</Chip>;
  if (decision === 'suitable') return <Chip tone="good">Suitable</Chip>;
  if (decision === 'review') return <Chip tone="warn" symbol="?">Needs review</Chip>;
  if (decision === 'unsuitable') return <Chip tone="neutral" symbol="✕">Not suitable</Chip>;
  return <Chip tone="neutral" symbol="…">Not scored yet</Chip>;
}

const RUN_STATUS: Record<RunRecord['status'], [Tone, string, string]> = {
  running: ['info', '…', 'Running'],
  ok: ['good', '✓', 'Completed'],
  partial: ['warn', '!', 'Completed with problems'],
  error: ['bad', '✕', 'Failed'],
};

export function RunChip({ status }: { status: RunRecord['status'] }) {
  const [tone, symbol, text] = RUN_STATUS[status];
  return (
    <Chip tone={tone} symbol={symbol}>
      {text}
    </Chip>
  );
}

export const TRIGGER_TEXT: Record<RunRecord['trigger'], string> = {
  schedule: 'Scheduled',
  manual: 'Run now',
  startup: 'At start-up',
  cli: 'Command line',
};

const REASON: Record<AnalysisReason['tone'], [string, string]> = {
  good: ['✓', 'In favour'],
  warn: ['!', 'Check'],
  bad: ['−', 'Against'],
  block: ['✕', 'Rules it out'],
};

export function ReasonList({ reasons }: { reasons: AnalysisReason[] }) {
  if (reasons.length === 0) return <p className="muted">No reasons were recorded.</p>;
  return (
    <ul className="reasons">
      {reasons.map((r, i) => {
        const [symbol, label] = REASON[r.tone];
        return (
          <li key={i} className={`reason reason-${r.tone}`}>
            <span className="reason-symbol" aria-hidden="true">
              {symbol}
            </span>
            <span>
              <span className="reason-label">{label}: </span>
              {r.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="score score-none">No score</span>;
  const band = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
  return (
    <span className={`score score-${band}`} title="Suitability score out of 100">
      <span className="score-num">{score}</span>
      <span className="score-of">/100</span>
      <span className="score-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </span>
    </span>
  );
}

/** The score, and on click the main reasons for it in plain words. */
export function ScoreWithReasons({ score, reasons }: { score: number | null; reasons: AnalysisReason[] }) {
  if (score === null || reasons.length === 0) return <ScoreBadge score={score} />;
  // Reasons that rule a bid out or count against it come first: they explain a low score.
  const order: Record<AnalysisReason['tone'], number> = { block: 0, bad: 1, warn: 2, good: 3 };
  const top = [...reasons].sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 3);
  return (
    <Popover trigger={<ScoreBadge score={score} />} label={`Suitability ${score} out of 100. Show why`} className="score-popover">
      <span className="popover-title">Why {score}/100</span>
      <ReasonList reasons={top} />
    </Popover>
  );
}
