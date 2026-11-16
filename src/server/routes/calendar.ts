import { DateTime } from 'luxon';
import type { Opportunity } from '../../shared/schemas.js';

/** Escape a TEXT value (RFC 5545 §3.3.11). */
export function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets without splitting a UTF-8 character (RFC 5545 §3.1). */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    // Continuation lines start with a space, which counts towards their 75 octets.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

function utcStamp(date: DateTime): string {
  return date.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

/** A calendar with one event per closing date. Date-only closings become all-day events in the local zone. */
export function buildCalendar(opportunities: Opportunity[], now: Date, zone: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lgbids//Bid closing dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Bid closing dates',
  ];
  const stamp = utcStamp(DateTime.fromJSDate(now));
  for (const opp of opportunities) {
    if (!opp.closesAt) continue;
    const closes = DateTime.fromISO(opp.closesAt, { zone: 'utc' });
    if (!closes.isValid) continue;
    lines.push('BEGIN:VEVENT', `UID:opportunity-${opp.id}@lgbids`, `DTSTAMP:${stamp}`);
    if (opp.closesAtPrecision === 'date') {
      const day = closes.setZone(zone).startOf('day');
      lines.push(`DTSTART;VALUE=DATE:${day.toFormat('yyyyMMdd')}`, `DTEND;VALUE=DATE:${day.plus({ days: 1 }).toFormat('yyyyMMdd')}`);
    } else {
      lines.push(`DTSTART:${utcStamp(closes)}`, `DTEND:${utcStamp(closes.plus({ minutes: 30 }))}`);
    }
    const details = [
      opp.organization && `Buyer: ${opp.organization}`,
      opp.referenceNumber && `Reference: ${opp.referenceNumber}`,
      opp.closesAtRaw && `Closing as stated: ${opp.closesAtRaw}`,
      opp.url,
    ].filter(Boolean);
    lines.push(`SUMMARY:${icsEscape(`Bid closes: ${opp.title}`)}`, `DESCRIPTION:${icsEscape(details.join('\n'))}`);
    if (/^https?:\/\//i.test(opp.url)) lines.push(`URL:${opp.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}
