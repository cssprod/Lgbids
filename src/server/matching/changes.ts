import type { DatePrecision, DocumentLink, NoticeChangeKind, OpportunityStatus } from '../../shared/schemas.js';
import { closingDeadline, formatLocal } from '../util/dates.js';

/**
 * What changed between two readings of the same notice. Pure: the store
 * decides when to compare and saves the result.
 */

/** The parts of a notice whose changes matter to someone preparing a bid. */
export interface NoticeSnapshot {
  closesAt: string | null;
  closesAtPrecision: DatePrecision | null;
  status: OpportunityStatus;
  documents: DocumentLink[];
  description: string;
}

/** A change before it is saved (the store adds the id, notice and time). */
export interface ChangeDraft {
  kind: NoticeChangeKind;
  summary: string;
  before: string;
  after: string;
  addendum: boolean;
}

/** File names that usually mean the buyer changed or clarified the bid documents. */
export const ADDENDUM_NAME = /addend|amend|revis|clarif/i;

const STATUS_WORDS: Record<OpportunityStatus, string> = {
  open: 'open',
  closed: 'closed',
  cancelled: 'cancelled',
  awarded: 'awarded',
};

/** Long text is cut so a change row stays small; the notice itself keeps the full text. */
const MAX_VALUE = 500;

function cut(text: string): string {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

function flat(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/(?:\.\.\.|…)\s*$/, '').trim().toLowerCase();
}

function localDay(iso: string, zone: string): string {
  return formatLocal(iso, 'date', zone);
}

function closingChange(before: NoticeSnapshot, after: NoticeSnapshot, zone: string): ChangeDraft | null {
  if (!after.closesAt) return null; // A closing date is never taken away, only replaced.
  const when = (s: NoticeSnapshot) => formatLocal(s.closesAt, s.closesAtPrecision, zone);
  if (!before.closesAt) {
    return { kind: 'closing_added', summary: `The closing date is now known: ${when(after)}.`, before: '', after: after.closesAt, addendum: false };
  }
  const sameDay = localDay(before.closesAt, zone) === localDay(after.closesAt, zone);
  // A date-only closing that gains its time on the same day is more detail, not a
  // new deadline; it is kept as a record but never alerted.
  if (sameDay && before.closesAtPrecision === 'date' && after.closesAtPrecision === 'datetime') {
    return { kind: 'closing_refined', summary: `The closing time is now known: ${when(after)}.`, before: before.closesAt, after: after.closesAt, addendum: false };
  }
  // The other way round (a time reported again as only a date) says nothing new.
  if (sameDay && after.closesAtPrecision === 'date' && before.closesAtPrecision === 'datetime') return null;
  const a = closingDeadline(before.closesAt, before.closesAtPrecision, zone).getTime();
  const b = closingDeadline(after.closesAt, after.closesAtPrecision, zone).getTime();
  if (a === b) return null;
  return {
    kind: 'closing_moved',
    summary: `The closing date moved from ${when(before)} to ${when(after)}.`,
    before: before.closesAt,
    after: after.closesAt,
    addendum: false,
  };
}

function documentsChange(before: NoticeSnapshot, after: NoticeSnapshot): ChangeDraft | null {
  const known = new Set(before.documents.map((d) => d.url));
  const added = after.documents.filter((d) => !known.has(d.url));
  if (added.length === 0) return null;
  const addendum = added.some((d) => ADDENDUM_NAME.test(`${d.name} ${decodeURIComponentSafe(d.url)}`));
  // The first documents seen for a notice are part of reading it, not a change,
  // unless one of them is plainly an addendum.
  if (before.documents.length === 0 && !addendum) return null;
  const names = added.map((d) => d.name || d.url);
  const summary =
    added.length === 1
      ? `${addendum ? 'An addendum was posted' : 'A new document was posted'}: ${names[0]}.`
      : `${added.length} new documents were posted${addendum ? ', including an addendum' : ''}: ${names.join(', ')}.`;
  return {
    kind: 'documents_added',
    summary: cut(summary),
    before: cut(before.documents.map((d) => d.name || d.url).join(', ')),
    after: cut(names.join(', ')),
    addendum,
  };
}

function decodeURIComponentSafe(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function descriptionChange(before: NoticeSnapshot, after: NoticeSnapshot): ChangeDraft | null {
  const a = flat(before.description);
  const b = flat(after.description);
  // Filling an empty description, or a summary growing into the full text, is not a change.
  if (!a || !b || a === b || b.includes(a)) return null;
  return { kind: 'description_changed', summary: 'The notice text was changed.', before: cut(before.description), after: cut(after.description), addendum: false };
}

/**
 * Compare two readings of one notice. Closing dates are compared by the
 * deadline used for sending (`closingDeadline`), so a date-only closing and
 * the end of that same day are not reported as a move.
 */
export function diffNotice(before: NoticeSnapshot, after: NoticeSnapshot, zone = 'America/Vancouver'): ChangeDraft[] {
  const out: ChangeDraft[] = [];
  const closing = closingChange(before, after, zone);
  if (closing) out.push(closing);
  const documents = documentsChange(before, after);
  if (documents) out.push(documents);
  if (before.status !== after.status) {
    out.push({
      kind: 'status_changed',
      summary: `The notice is now ${STATUS_WORDS[after.status]} (it was ${STATUS_WORDS[before.status]}).`,
      before: before.status,
      after: after.status,
      addendum: false,
    });
  }
  const description = descriptionChange(before, after);
  if (description) out.push(description);
  return out;
}

/** Kinds that change what the bid needs (or whether it can still be made); a refinement is not one. */
export function isLoudChange(kind: NoticeChangeKind): boolean {
  return kind !== 'closing_refined';
}
