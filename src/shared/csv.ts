import { FEEDBACK_REASON_LABELS, NOTICE_TYPE_LABELS, SUBMISSION_METHOD_LABELS, type FeedbackRecord, type Opportunity } from './schemas.js';

/**
 * Spreadsheet export, shared by the server route and the in-browser
 * prototype so both produce the same file. Pure: no I/O, no time zone
 * handling (callers pass the date formatter they use for the user).
 */

/** Excel only reads a CSV as UTF-8 when it starts with a byte-order mark. */
export const CSV_BOM = '﻿';

// A cell starting with one of these is run as a formula by Excel, Sheets and
// LibreOffice; text copied from a bid site must never become one.
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula-guarded, and quoted when it holds a quote, comma or line break. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text with CRLF line ends (RFC 4180), starting with the BOM. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const OPPORTUNITY_CSV_HEADERS = ['Title', 'Buyer', 'Source', 'Reference', 'Type', 'Decision', 'Score', 'Closes', 'Submission', 'Link', 'First seen'];

/** The decision as the Opportunities page words it; the user's own choice wins. */
export function decisionLabel(o: Pick<Opportunity, 'decision' | 'userDecision'>): string {
  if (o.userDecision === 'dismissed') return 'Dismissed';
  if (o.userDecision === 'pursue') return 'Pursuing';
  if (o.decision === 'suitable') return 'Suitable';
  if (o.decision === 'review') return 'Needs review';
  if (o.decision === 'unsuitable') return 'Not suitable';
  return 'Not scored yet';
}

export interface CsvDates {
  /** Closing date in the user's time zone; date-only closings show the date alone. */
  closes(o: Opportunity): string;
  firstSeen(o: Opportunity): string;
}

/**
 * Award columns (UX-13), added after the others. "Award status" says whether
 * the person confirmed the winner or Lgbids only read it from a notice, so a
 * suggestion is never passed off as fact.
 */
export const AWARD_CSV_HEADERS = ['Winner', 'Winning price', 'Awarded on', 'Award status'];

function awardCells(o: Opportunity): (string | number | null)[] {
  const a = o.award;
  if (!a) return ['', '', '', ''];
  return [a.winner, a.amount, a.awardedOn ?? '', a.status === 'confirmed' ? 'Confirmed' : 'Suggested from the award notice'];
}

export interface OpportunitiesCsvOptions {
  /** Add the award columns, read from each item's `award`. */
  awards?: boolean;
}

export function opportunitiesCsv(items: Opportunity[], dates: CsvDates, options: OpportunitiesCsvOptions = {}): string {
  const rows = items.map((o) => [
    o.title,
    o.organization,
    o.sourceName,
    o.referenceNumber,
    NOTICE_TYPE_LABELS[o.noticeType] ?? o.noticeType,
    decisionLabel(o),
    o.suitabilityScore,
    o.closesAt ? dates.closes(o) : 'Not stated',
    [SUBMISSION_METHOD_LABELS[o.submissionMethod] ?? o.submissionMethod, o.submissionEmail].filter(Boolean).join(' — '),
    o.url,
    dates.firstSeen(o),
    ...(options.awards ? awardCells(o) : []),
  ]);
  return toCsv([options.awards ? [...OPPORTUNITY_CSV_HEADERS, ...AWARD_CSV_HEADERS] : OPPORTUNITY_CSV_HEADERS, ...rows]);
}

/** lgbids-opportunities-YYYY-MM-DD.csv, dated by the caller's local day. */
export function opportunitiesCsvFilename(localDate: string): string {
  return `lgbids-opportunities-${localDate}.csv`;
}

export const FEEDBACK_CSV_HEADERS = [
  'Date',
  'Verdict',
  'Reasons',
  'Note',
  'Title',
  'Buyer',
  'Link',
  'Found via',
  'Source',
  'Type',
  'Score',
  'Decision',
  'Matched terms',
  'Services',
  'Area',
  'Area match',
  'Area rule',
  'Type rule',
  'Rules version',
];

/** Feedback on scores as a spreadsheet; the caller formats dates in the user's time zone. */
export function feedbackCsv(items: FeedbackRecord[], formatDate: (iso: string) => string): string {
  const rows = items.map((f) => [
    formatDate(f.createdAt),
    f.verdict === 'not_relevant' ? 'Not relevant' : 'Missed',
    f.reasons.map((r) => FEEDBACK_REASON_LABELS[r] ?? r).join('; '),
    f.note,
    f.title,
    f.organization,
    f.url,
    f.foundVia,
    f.sourceId,
    NOTICE_TYPE_LABELS[f.noticeType] ?? f.noticeType,
    f.score,
    f.decision ?? '',
    f.matchedTerms.join('; '),
    f.services.join('; '),
    f.area,
    f.areaMatch,
    f.trace?.areaRule ?? '',
    f.trace?.typeRule ?? '',
    f.lexiconVersion,
  ]);
  return toCsv([FEEDBACK_CSV_HEADERS, ...rows]);
}

/** lgbids-feedback-YYYY-MM-DD.csv, dated by the caller's local day. */
export function feedbackCsvFilename(localDate: string): string {
  return `lgbids-feedback-${localDate}.csv`;
}
