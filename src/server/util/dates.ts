import { DateTime } from 'luxon';
import type { DatePrecision } from '../../shared/schemas.js';

/**
 * Date parsing for bid notices.
 *
 * Closing dates arrive in every format imaginable ("2026/11/30 14:00 PST",
 * "Thursday, December 6th, 2018 at 2:00 p.m. local time", "30-Nov-2026") and
 * usually without a time zone. Everything is resolved to a UTC instant using
 * the zone stated in the text, or the caller's default zone (Pacific time for
 * Greater Victoria buyers).
 *
 * A date with no time is kept as precision "date" and resolved to the last
 * second of that day, so a notice is never marked closed before its closing
 * day is over. Anything that sends on a deadline treats such dates as closing
 * at the START of the day instead (see closingDeadline).
 */

export interface ParsedDate {
  /** UTC instant, ISO 8601. */
  iso: string;
  precision: DatePrecision;
}

export interface DateMatch extends ParsedDate {
  /** Position of the date expression in the searched text. */
  index: number;
  /** Position just past the date (and time, when one was attached). */
  end: number;
  text: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janvier: 1,
  feb: 2, february: 2, fev: 2, fevrier: 2,
  mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6,
  jul: 7, july: 7, juil: 7, juillet: 7,
  aug: 8, august: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

const MONTH_ALT =
  'january|february|march|april|may|june|july|august|september|october|november|december|' +
  'jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';

const ZONES: Record<string, string> = {
  pst: 'America/Vancouver', pdt: 'America/Vancouver', pt: 'America/Vancouver', pacific: 'America/Vancouver',
  mst: 'America/Edmonton', mdt: 'America/Edmonton', mt: 'America/Edmonton', mountain: 'America/Edmonton',
  cst: 'America/Winnipeg', cdt: 'America/Winnipeg', ct: 'America/Winnipeg', central: 'America/Winnipeg',
  est: 'America/Toronto', edt: 'America/Toronto', et: 'America/Toronto', eastern: 'America/Toronto',
  ast: 'America/Halifax', adt: 'America/Halifax', atlantic: 'America/Halifax',
  nst: 'America/St_Johns', ndt: 'America/St_Johns', newfoundland: 'America/St_Johns',
  utc: 'UTC', gmt: 'UTC', z: 'UTC',
};

interface Ymd {
  y: number;
  m: number;
  d: number;
  index: number;
  end: number;
}

interface Hm {
  h: number;
  min: number;
  zone: string | null;
  index: number;
  end: number;
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  return DateTime.utc(y, m, d).isValid;
}

function expandYear(two: number): number {
  return two < 100 ? 2000 + two : two;
}

/** Find every calendar date in the text, left to right, without overlaps. */
function findYmds(text: string, now: DateTime): Ymd[] {
  const found: Ymd[] = [];
  const push = (y: number, m: number, d: number, index: number, length: number) => {
    if (!validYmd(y, m, d)) return;
    found.push({ y, m, d, index, end: index + length });
  };

  // 2026-11-30, 2026/11/30, 2026.11.30 (optionally glued to a "T" time)
  for (const m of text.matchAll(/(?<![\d.])(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d])/g)) {
    push(Number(m[1]), Number(m[2]), Number(m[3]), m.index, m[0].length);
  }

  // 30/11/2026 or 11/30/2026. Only accepted when the order is unambiguous.
  for (const m of text.matchAll(/(?<![\d.-])(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})(?![\d])/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (a > 12 && b <= 12) push(y, b, a, m.index, m[0].length);
    else if (b > 12 && a <= 12) push(y, a, b, m.index, m[0].length);
    else if (a === b) push(y, a, b, m.index, m[0].length);
    // Otherwise 03/04/2026 could be either March 4 or April 3: leave it unparsed.
  }

  // November 30, 2026 / Nov. 30th 2026 / November 30 (year inferred)
  const monthFirst = new RegExp(
    `\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])(?:\\s*,?\\s*(20\\d{2})(?!\\d))?`,
    'gi',
  );
  for (const m of text.matchAll(monthFirst)) {
    const monthWord = m[1]!;
    const month = MONTHS[monthWord.toLowerCase()];
    if (!month) continue;
    const day = Number(m[2]);
    if (m[3]) {
      push(Number(m[3]), month, day, m.index, m[0].length);
      continue;
    }
    // No year: only trust a capitalised month, and "May 5" only when a comma or
    // a time follows, because "may 5" is far more often the verb.
    if (monthWord[0] !== monthWord[0]!.toUpperCase()) continue;
    if (monthWord.toLowerCase() === 'may') {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
      if (!/^\s*(?:,|at\b|@|by\b|\d{1,2}[:.]\d{2}|\d{1,2}\s*[ap]\.?\s?m)/i.test(after)) continue;
    }
    const year = inferYear(month, day, now);
    if (year) push(year, month, day, m.index, m[0].length);
  }

  // 30 November 2026 / 30-Nov-2026 / 30-Nov-26
  const dayFirst = new RegExp(
    `(?<![\\d:/.-])(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+|\\s*-\\s*)(${MONTH_ALT})\\.?(?:,?\\s+|\\s*-\\s*)(20\\d{2}|\\d{2})(?!\\d)`,
    'gi',
  );
  for (const m of text.matchAll(dayFirst)) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (!month) continue;
    push(expandYear(Number(m[3])), month, Number(m[1]), m.index, m[0].length);
  }

  found.sort((a, b) => a.index - b.index || b.end - a.end);
  const out: Ymd[] = [];
  for (const f of found) {
    const last = out[out.length - 1];
    if (last && f.index < last.end) continue;
    out.push(f);
  }
  return out;
}

/** Pick the year that puts a month/day closest to now (slightly favouring the future). */
function inferYear(month: number, day: number, now: DateTime): number | null {
  let best: { year: number; distance: number } | null = null;
  for (const year of [now.year - 1, now.year, now.year + 1]) {
    const candidate = DateTime.utc(year, month, day);
    if (!candidate.isValid) continue;
    const days = candidate.diff(now, 'days').days;
    const distance = days < 0 ? Math.abs(days) * 3 : days;
    if (!best || distance < best.distance) best = { year, distance };
  }
  return best ? best.year : null;
}

// Three-letter abbreviations in any case; two-letter ones only in capitals ("ET",
// not the word "et"); zone names only when followed by "Time", so that
// "2:00 PM, Central Saanich Municipal Hall" is not read as Central Time.
const ZONE_ABBR_3 = /^\s*,?\s*\(?(PST|PDT|MST|MDT|CST|CDT|EST|EDT|AST|ADT|NST|NDT|UTC|GMT)\b\)?/i;
const ZONE_ABBR_2 = /^\s*,?\s*\(?(PT|MT|CT|ET)\b\)?/;
const ZONE_NAMED = /^\s*,?\s*\(?(Pacific|Mountain|Central|Eastern|Atlantic|Newfoundland)\s+(?:(?:Standard|Daylight)\s+)?Time\b\)?/i;

function zoneAfter(text: string, from: number): { zone: string; end: number } | null {
  const tail = text.slice(from, from + 40);
  const m = ZONE_ABBR_3.exec(tail) ?? ZONE_ABBR_2.exec(tail) ?? ZONE_NAMED.exec(tail);
  if (!m) return null;
  const zone = ZONES[m[1]!.toLowerCase()];
  return zone ? { zone, end: from + m[0].length } : null;
}

/** Find clock times in the text. */
function findTimes(text: string): Hm[] {
  const out: Hm[] = [];
  const add = (h: number, min: number, index: number, length: number) => {
    if (h < 0 || h > 23 || min < 0 || min > 59) return;
    let end = index + length;
    const zone = zoneAfter(text, end);
    if (zone) end = zone.end;
    out.push({ h, min, zone: zone?.zone ?? null, index, end });
  };

  // 2:00 PM, 2 p.m., 2:00:00pm, 02h00 pm
  for (const m of text.matchAll(/(?<![\d:.])(\d{1,2})(?:[:.h](\d{2}))?(?::\d{2})?\s*([ap])\.?\s?m\b\.?/gi)) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h < 1 || h > 12) continue;
    const pm = m[3]!.toLowerCase() === 'p';
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    add(h, min, m.index, m[0].length);
  }

  // 14:00, 14:00:00, T14:00:00
  for (const m of text.matchAll(/(?<![\d:.])(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\s*[ap]\.?\s?m\b)(?![\d:])/gi)) {
    add(Number(m[1]), Number(m[2]), m.index, m[0].length);
  }

  // 1400 hrs, 14h00
  for (const m of text.matchAll(/(?<![\d:.])([01]\d|2[0-3])([0-5]\d)\s*(?:hrs?|hours)\b\.?/gi)) {
    add(Number(m[1]), Number(m[2]), m.index, m[0].length);
  }
  for (const m of text.matchAll(/(?<![\d:.])([01]?\d|2[0-3])\s?h\s?([0-5]\d)(?!\d)(?!\s*[ap]\.?\s?m)/gi)) {
    add(Number(m[1]), Number(m[2]), m.index, m[0].length);
  }

  for (const m of text.matchAll(/\b(?:12\s+)?noon\b/gi)) add(12, 0, m.index, m[0].length);

  out.sort((a, b) => a.index - b.index || b.end - a.end);
  const clean: Hm[] = [];
  for (const t of out) {
    const last = clean[clean.length - 1];
    if (last && t.index < last.end) continue;
    clean.push(t);
  }
  return clean;
}

function toIso(ymd: Ymd, time: Hm | null, defaultZone: string): ParsedDate | null {
  const zone = time?.zone ?? defaultZone;
  const dt = time
    ? DateTime.fromObject({ year: ymd.y, month: ymd.m, day: ymd.d, hour: time.h, minute: time.min }, { zone })
    : DateTime.fromObject({ year: ymd.y, month: ymd.m, day: ymd.d, hour: 23, minute: 59, second: 59 }, { zone });
  if (!dt.isValid) return null;
  const iso = dt.toUTC().toISO({ suppressMilliseconds: true });
  return iso ? { iso, precision: time ? 'datetime' : 'date' } : null;
}

export interface ParseOptions {
  /** IANA zone used when the text does not state one. */
  zone?: string;
  now?: Date;
}

/**
 * Every date in the text, each paired with the clock time written next to it
 * (within a few words after it, or just before it), if any.
 */
export function findDates(text: string, opts: ParseOptions = {}): DateMatch[] {
  if (!text) return [];
  const zone = opts.zone ?? 'America/Vancouver';
  const now = DateTime.fromJSDate(opts.now ?? new Date(), { zone: 'utc' });
  const ymds = findYmds(text, now);
  if (ymds.length === 0) return [];
  const times = findTimes(text);
  const used = new Set<Hm>();
  const out: DateMatch[] = [];

  ymds.forEach((ymd, i) => {
    const next = ymds[i + 1];
    const prev = ymds[i - 1];
    // A time directly after the date, e.g. "Nov 30, 2026 at 2:00 PM" or "2026-11-30T14:00".
    let time =
      times.find(
        (t) =>
          !used.has(t) &&
          t.index >= ymd.end &&
          t.index - ymd.end <= 28 &&
          (!next || t.index < next.index) &&
          !/[.;!?]\s/.test(text.slice(ymd.end, t.index)),
      ) ?? null;
    // Or just before it, e.g. "2:00 p.m. local time on Thursday, December 6, 2018".
    if (!time) {
      time =
        [...times]
          .reverse()
          .find(
            (t) =>
              !used.has(t) &&
              t.end <= ymd.index &&
              ymd.index - t.end <= 40 &&
              (!prev || t.index >= prev.end) &&
              !/[.;!?]\s/.test(text.slice(t.end, ymd.index)),
          ) ?? null;
    }
    if (time) used.add(time);
    const parsed = toIso(ymd, time, zone);
    if (!parsed) return;
    const index = time ? Math.min(ymd.index, time.index) : ymd.index;
    const end = time ? Math.max(ymd.end, time.end) : ymd.end;
    out.push({ ...parsed, index, end, text: text.slice(index, end) });
  });
  return out;
}

/** Parse a string that is expected to hold one date (a table cell, a feed field). */
export function parseDate(input: string | null | undefined, opts: ParseOptions = {}): ParsedDate | null {
  if (!input) return null;
  const text = input.trim();
  if (!text) return null;
  const zone = opts.zone ?? 'America/Vancouver';

  // Machine formats first: they carry their own offset.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const dt = DateTime.fromISO(text, { setZone: true });
    if (dt.isValid) return { iso: dt.toUTC().toISO({ suppressMilliseconds: true })!, precision: 'datetime' };
  }
  if (/^[A-Za-z]{3},?\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{1,2}:\d{2}/.test(text)) {
    const dt = DateTime.fromRFC2822(text, { setZone: true });
    if (dt.isValid) return { iso: dt.toUTC().toISO({ suppressMilliseconds: true })!, precision: 'datetime' };
    const http = DateTime.fromHTTP(text, { setZone: true });
    if (http.isValid) return { iso: http.toUTC().toISO({ suppressMilliseconds: true })!, precision: 'datetime' };
  }
  if (/^\d{10}$/.test(text) || /^\d{13}$/.test(text)) {
    const ms = text.length === 10 ? Number(text) * 1000 : Number(text);
    const dt = DateTime.fromMillis(ms, { zone: 'utc' });
    if (dt.isValid && dt.year >= 2000 && dt.year <= 2100) {
      return { iso: dt.toISO({ suppressMilliseconds: true })!, precision: 'datetime' };
    }
  }

  const first = findDates(text, { zone, now: opts.now })[0];
  return first ? { iso: first.iso, precision: first.precision } : null;
}

const CLOSING_LABEL =
  /\b(clos(?:ing|es|ed|ure|e)|deadline|due(?:\s+date)?|submission\s+(?:date|deadline|time)|end\s+date|no\s+later\s+than|not\s+later\s+than|(?:received|accepted|submitted)\s+(?:on\s+or\s+)?(?:before|until|up\s+to|by|prior\s+to)|until|expir(?:es|y|ation))\b/gi;

const NOT_CLOSING_NEAR =
  /\b(question|inquir|enquir|clarification|site\s+(?:meeting|visit|tour)|pre-?bid|information\s+(?:meeting|session)|addend|award|start\s+date|commenc|posted|publish|issued|issue\s+date|open(?:ing|ed|s)?\s+date)\w*[^.;]{0,60}$/i;

/**
 * Find the bid closing date in free text: the first date that follows a
 * closing-style label ("Closing Date:", "must be received before", "deadline").
 * Dates that belong to something else (question deadlines, site meetings,
 * posting dates) are skipped.
 */
export function findClosingDate(text: string, opts: ParseOptions = {}): DateMatch | null {
  if (!text) return null;
  const dates = findDates(text, opts);
  if (dates.length === 0) return null;
  const labels = [...text.matchAll(CLOSING_LABEL)];
  let best: DateMatch | null = null;
  let bestGap = Infinity;
  for (const label of labels) {
    const labelEnd = label.index + label[0].length;
    const before = text.slice(Math.max(0, label.index - 70), label.index);
    // "Questions deadline: ..." and friends are not the bid closing.
    if (NOT_CLOSING_NEAR.test(before)) continue;
    const date = dates.find((d) => d.index >= labelEnd && d.index - labelEnd <= 140);
    if (!date) continue;
    const between = text.slice(labelEnd, date.index);
    if (/\b(question|inquir|enquir|clarification|site\s+(?:meeting|visit)|addend)/i.test(between)) continue;
    const gap = date.index - labelEnd;
    // Prefer the explicit "closing" words over the looser ones.
    const strong = /^(clos|deadline|due|submission)/i.test(label[0]);
    const weighted = strong ? gap : gap + 60;
    if (weighted < bestGap) {
      best = date;
      bestGap = weighted;
    }
  }
  return best;
}

/**
 * The instant after which nothing should be sent for this opportunity.
 * For date-only closings that is the start of the closing day (most bids
 * close in the early afternoon; midnight would be dangerously late).
 */
export function closingDeadline(iso: string, precision: DatePrecision | null, zone = 'America/Vancouver'): Date {
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (precision === 'date') return dt.setZone(zone).startOf('day').toUTC().toJSDate();
  return dt.toJSDate();
}

export function hoursUntil(iso: string, now: Date): number {
  return (new Date(iso).getTime() - now.getTime()) / 3_600_000;
}

/** "Mon, Nov 30, 2026, 2:00 p.m. PST" (or without a time for date-only values). */
export function formatLocal(iso: string | null, precision: DatePrecision | null = 'datetime', zone = 'America/Vancouver'): string {
  if (!iso) return '';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
  if (!dt.isValid) return '';
  if (precision === 'date') return dt.toFormat('ccc, LLL d, yyyy');
  return `${dt.toFormat('ccc, LLL d, yyyy')} at ${dt.toFormat('h:mm a')} ${dt.toFormat('ZZZZ')}`;
}

export function nowIso(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
