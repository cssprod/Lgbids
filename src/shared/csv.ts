import { NOTICE_TYPE_LABELS, SUBMISSION_METHOD_LABELS, type Opportunity } from './schemas.js';

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

export function opportunitiesCsv(items: Opportunity[], dates: CsvDates): string {
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
  ]);
  return toCsv([OPPORTUNITY_CSV_HEADERS, ...rows]);
}

/** lgbids-opportunities-YYYY-MM-DD.csv, dated by the caller's local day. */
export function opportunitiesCsvFilename(localDate: string): string {
  return `lgbids-opportunities-${localDate}.csv`;
}
