import { useState } from 'react';
import type { NoticeChange, Opportunity } from '../../../shared/schemas.js';
import { errorMessage, markChangesSeen } from '../../api.js';
import { useFormat } from '../../hooks.js';
import { useToast } from '../Toast.js';
import { Chip, Section } from '../ui.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

interface Formatter {
  timeZone: string;
  date: (iso: string) => string;
  dateTime: (iso: string) => string;
}

/** A before or after value as the user reads it: dates in local time, other text as it is. */
export function changeValue(value: string, f: Formatter, dateOnly = false): string {
  const text = value.trim();
  if (!text) return 'nothing stated';
  if (!ISO.test(text)) return text.length > 200 ? `${text.slice(0, 199)}…` : text;
  // Date-only closings are stored as the end of the local day; showing 11:59 PM would suggest a time the notice never gave.
  if (dateOnly) return f.date(text);
  const hm = new Intl.DateTimeFormat('en-CA', { timeZone: f.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(text));
  return hm === '23:59' ? f.date(text) : f.dateTime(text);
}

/** The banner sentence for a change; a moved closing names both dates. */
export function bannerSentence(change: NoticeChange, f: Formatter, dateOnly = false): string {
  const noticed = f.date(change.detectedAt);
  if (change.kind === 'closing_moved') {
    return `The closing date moved from ${changeValue(change.before, f, dateOnly)} to ${changeValue(change.after, f, dateOnly)} (noticed ${noticed}).`;
  }
  const summary = change.summary.trim().replace(/[.!?]?$/, '');
  return `${summary} (noticed ${noticed}).`;
}

export interface ChangesSectionProps {
  /** A detail response, which carries `changes`. */
  opportunity: Opportunity;
  onChange: (updated: Opportunity) => void;
}

/** "What changed" timeline on the bid page, newest first (MAT-15). */
export function ChangesSection({ opportunity, onChange }: ChangesSectionProps) {
  const f = useFormat();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const changes = opportunity.changes ?? [];
  // A date-only closing is shown as a date, never as the 11:59 PM it is stored as.
  const dateOnly = (kind: string) => kind.startsWith('closing_') && opportunity.closesAtPrecision === 'date';
  if (changes.length === 0) return null;

  async function seen() {
    setBusy(true);
    try {
      onChange(await markChangesSeen(opportunity.id));
    } catch (e) {
      toast({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="What changed"
      actions={
        opportunity.unseenChanges > 0 ? (
          <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void seen()}>
            Got it
          </button>
        ) : undefined
      }
    >
      <p className="muted small">What the buyer changed since Lgbids first read this notice, newest first.</p>
      <ol className="stack-list">
        {changes.map((c) => (
          <li key={c.id}>
            <p className="small muted">
              Noticed {f.dateTime(c.detectedAt)}
              {c.seenAt === null && c.kind !== 'closing_refined' ? (
                <>
                  {' '}
                  <Chip tone="warn" symbol="↻">
                    New
                  </Chip>
                </>
              ) : null}
              {c.addendum ? (
                <>
                  {' '}
                  <Chip tone="info">Addendum</Chip>
                </>
              ) : null}
            </p>
            <p>{c.summary}</p>
            {c.before || c.after ? (
              <p className="small muted">
                Before: {changeValue(c.before, f, dateOnly(c.kind))}; after: {changeValue(c.after, f, dateOnly(c.kind))}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}
