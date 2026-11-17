import type { DatePrecision } from '../shared/schemas.js';

/** Formatting helpers. Every date is shown in the business's time zone, not the browser's. */

const LOCALE = 'en-CA';
const cache = new Map<string, Intl.DateTimeFormat>();

/**
 * British Columbia has been on UTC−7 all year since 2026. A browser whose time
 * zone data predates that change still puts Vancouver at UTC−8 in winter and
 * would show every closing time an hour early. Detect that and use a fixed
 * UTC−7 zone instead ("Etc/GMT+7" is UTC−7: the sign is inverted by convention).
 */
let vancouverOutdated: boolean | null = null;
function effectiveZone(timeZone: string): string {
  if (timeZone !== 'America/Vancouver') return timeZone;
  if (vancouverOutdated === null) {
    try {
      const hour = new Intl.DateTimeFormat('en-CA', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date('2027-01-15T20:00:00Z'));
      vancouverOutdated = Number(hour) === 12; // 20:00 UTC is 13:00 at UTC−7, 12:00 at UTC−8.
    } catch {
      vancouverOutdated = false;
    }
  }
  return vancouverOutdated ? 'Etc/GMT+7' : timeZone;
}

function dtf(requestedZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const timeZone = effectiveZone(requestedZone);
  const key = timeZone + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone });
    } catch {
      // An unknown zone name would otherwise break every screen.
      f = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: 'America/Vancouver' });
    }
    cache.set(key, f);
  }
  return f;
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  const d = toDate(iso);
  if (!d) return 'Not stated';
  return dtf(timeZone, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatDate(iso: string | null | undefined, timeZone: string): string {
  const d = toDate(iso);
  if (!d) return 'Not stated';
  return dtf(timeZone, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}

/** Short time for "today at" style lists. */
export function formatShort(iso: string | null | undefined, timeZone: string): string {
  const d = toDate(iso);
  if (!d) return '';
  return dtf(timeZone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}

/** A plain calendar date (YYYY-MM-DD) such as a document expiry, shown without time-zone shifts. */
export function formatPlainDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return dtf('UTC', { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}

function dayKey(d: Date, timeZone: string): number {
  const parts = dtf(timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000;
}

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/** "in 3 days", "in 5 hours", "2 days ago", "today". */
export function relative(iso: string | null | undefined, timeZone: string, precision: DatePrecision | null = 'datetime', now = new Date()): string {
  const d = toDate(iso);
  if (!d) return '';
  if (precision === 'date') {
    return rtf.format(dayKey(d, timeZone) - dayKey(now, timeZone), 'day');
  }
  const diffMs = d.getTime() - now.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(hours) < 36) return rtf.format(hours, 'hour');
  return rtf.format(dayKey(d, timeZone) - dayKey(now, timeZone), 'day');
}

export interface ClosingText {
  relative: string;
  absolute: string;
  past: boolean;
  soon: boolean;
}

export function closingText(
  iso: string | null,
  precision: DatePrecision | null,
  raw: string,
  timeZone: string,
  now = new Date(),
): ClosingText {
  const d = toDate(iso);
  if (!d) {
    return { relative: 'Closing date not stated', absolute: raw ? `Notice says: ${raw}` : 'Check the notice', past: false, soon: false };
  }
  const past = d.getTime() < now.getTime();
  const soon = !past && d.getTime() - now.getTime() < 7 * 86_400_000;
  const absolute = precision === 'date' ? `${formatDate(iso, timeZone)}, time not stated` : formatDateTime(iso, timeZone);
  const rel = relative(iso, timeZone, precision, now);
  return { relative: past ? `Closed ${rel}` : `Closes ${rel}`, absolute, past, soon };
}

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'CAD' });
const moneyWhole = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

export function formatMoney(n: number | null | undefined, whole = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'Not entered';
  return (whole ? moneyWhole : money).format(n);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Days from today until a YYYY-MM-DD date; negative when it has passed. */
export function daysUntilPlainDate(ymd: string, timeZone: string, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
  return target - dayKey(now, timeZone);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A sentence saying what is wrong with an e-mail address, or undefined when it looks fine (or is empty). */
export function emailProblem(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (/\s/.test(v)) return 'An e-mail address cannot contain spaces.';
  if (!/^[^@]+@[^@]+\.[^@.]{2,}$/.test(v)) return 'Enter a full e-mail address, for example name@example.com.';
  return undefined;
}
