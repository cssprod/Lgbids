import { describe, expect, it } from 'vitest';
import { closingDeadline, findClosingDate, findDates, formatLocal, parseDate } from '../src/server/util/dates.js';

// All expectations use summer dates: Pacific time is UTC-7 in July under both
// the pre-2026 rules and British Columbia's year-round rule adopted in 2026, so
// these tests do not depend on how new the runtime's time zone data is.
const now = new Date('2026-06-15T20:00:00Z');
const opts = { zone: 'America/Vancouver', now };

describe('parseDate', () => {
  it('reads ISO timestamps with an offset as exact instants', () => {
    expect(parseDate('2026-07-09T14:00:00-07:00', opts)).toEqual({ iso: '2026-07-09T21:00:00Z', precision: 'datetime' });
    expect(parseDate('2026-07-09T21:00:00Z', opts)).toEqual({ iso: '2026-07-09T21:00:00Z', precision: 'datetime' });
    expect(parseDate('2026-07-09T21:00:00.000Z', opts)?.iso).toBe('2026-07-09T21:00:00Z');
  });

  it('treats a zone-less timestamp as local time in the default zone', () => {
    expect(parseDate('2026-07-09T14:00:00', opts)).toEqual({ iso: '2026-07-09T21:00:00Z', precision: 'datetime' });
    expect(parseDate('2026-07-09 14:00', opts)).toEqual({ iso: '2026-07-09T21:00:00Z', precision: 'datetime' });
    // The same wall-clock time read as Eastern (UTC-4 in July) is three hours earlier.
    expect(parseDate('2026-07-09T14:00:00', { ...opts, zone: 'America/Toronto' })?.iso).toBe('2026-07-09T18:00:00Z');
  });

  it('honours a zone written after the time', () => {
    expect(parseDate('2026/07/09 14:00 EDT', opts)?.iso).toBe('2026-07-09T18:00:00Z');
    expect(parseDate('July 9, 2026 2:00 PM Pacific Time', opts)?.iso).toBe('2026-07-09T21:00:00Z');
    expect(parseDate('July 9, 2026 5:00 PM ET', opts)?.iso).toBe('2026-07-09T21:00:00Z');
    expect(parseDate('July 9, 2026 21:00 UTC', opts)?.iso).toBe('2026-07-09T21:00:00Z');
  });

  it('does not mistake "Central Saanich" for Central Time', () => {
    expect(parseDate('July 9, 2026 at 2:00 PM, Central Saanich Municipal Hall', opts)?.iso).toBe('2026-07-09T21:00:00Z');
  });

  it('reads written-out dates in the usual municipal styles', () => {
    const cases: string[] = [
      'July 9, 2026 at 2:00 PM',
      'Jul. 9, 2026 2:00 p.m.',
      'Thursday, July 9th, 2026 @ 2pm',
      '9 July 2026, 14:00',
      '09-Jul-2026 14:00',
      '2:00 p.m. local time on Thursday, July 9, 2026',
      'July 9, 2026 at 1400 hrs',
      'July 9, 2026 2:00:00 PM',
    ];
    for (const input of cases) {
      expect(parseDate(input, opts), input).toEqual({ iso: '2026-07-09T21:00:00Z', precision: 'datetime' });
    }
    expect(parseDate('July 9, 2026 12 noon', opts)?.iso).toBe('2026-07-09T19:00:00Z');
  });

  it('keeps date-only values as date precision at the end of that local day', () => {
    const endOfDay = { iso: '2026-07-10T06:59:59Z', precision: 'date' };
    expect(parseDate('2026-07-09', opts)).toEqual(endOfDay);
    expect(parseDate('2026/07/09', opts)).toEqual(endOfDay);
    expect(parseDate('July 9, 2026', opts)).toEqual(endOfDay);
    expect(parseDate('09-Jul-26', opts)).toEqual(endOfDay);
  });

  it('infers a missing year as the nearest sensible one', () => {
    expect(parseDate('July 9 at 2:00 PM', opts)?.iso).toBe('2026-07-09T21:00:00Z');
    // From mid-November, "January 8" means next January.
    const november = { zone: 'America/Vancouver', now: new Date('2026-11-13T20:00:00Z') };
    expect(parseDate('January 8, 2:00 PM', november)?.iso.slice(0, 10)).toBe('2027-01-08');
    // A date a few days back is still this year, not next.
    expect(parseDate('June 10 at 2:00 PM', opts)?.iso.slice(0, 10)).toBe('2026-06-10');
  });

  it('refuses numeric dates whose day/month order is ambiguous', () => {
    expect(parseDate('03/04/2026', opts)).toBeNull();
    expect(parseDate('30/07/2026', opts)?.iso).toBe('2026-07-31T06:59:59Z');
    expect(parseDate('07/30/2026', opts)?.iso).toBe('2026-07-31T06:59:59Z');
  });

  it('reads RSS (RFC 822) dates', () => {
    expect(parseDate('Thu, 09 Jul 2026 08:00:00 -0700', opts)).toEqual({ iso: '2026-07-09T15:00:00Z', precision: 'datetime' });
    expect(parseDate('Thu, 09 Jul 2026 15:00:00 GMT', opts)?.iso).toBe('2026-07-09T15:00:00Z');
  });

  it('returns null for text without a date', () => {
    expect(parseDate('', opts)).toBeNull();
    expect(parseDate(null, opts)).toBeNull();
    expect(parseDate('To be announced', opts)).toBeNull();
    expect(parseDate('Proponents may 5 times request an extension', opts)).toBeNull();
    expect(parseDate('July 2026', opts)).toBeNull();
    expect(parseDate('2026-13-45', opts)).toBeNull();
    expect(parseDate('February 30, 2026', opts)).toBeNull();
  });
});

describe('findDates', () => {
  it('pairs each date with its own time', () => {
    const text = 'Issued June 22, 2026. Questions by July 2, 2026 at 4:00 PM. Closes July 9, 2026 at 2:00 PM.';
    const found = findDates(text, opts);
    expect(found.map((d) => [d.iso, d.precision])).toEqual([
      ['2026-06-23T06:59:59Z', 'date'],
      ['2026-07-02T23:00:00Z', 'datetime'],
      ['2026-07-09T21:00:00Z', 'datetime'],
    ]);
  });
});

describe('findClosingDate', () => {
  it('finds a labelled closing date', () => {
    expect(findClosingDate('Closing Date: July 9th, 2026 2:00 PM', opts)?.iso).toBe('2026-07-09T21:00:00Z');
    expect(findClosingDate('Tenders will be received until 2:00 PM local time, Thursday, July 9, 2026.', opts)?.iso).toBe(
      '2026-07-09T21:00:00Z',
    );
    expect(findClosingDate('Submissions must be received before 2:00:00 PM Pacific Time on July 9, 2026', opts)?.iso).toBe(
      '2026-07-09T21:00:00Z',
    );
    expect(findClosingDate('Closing: 2026-07-09', opts)).toMatchObject({ iso: '2026-07-10T06:59:59Z', precision: 'date' });
  });

  it('ignores question deadlines, site meetings and posting dates', () => {
    const text =
      'Posted: June 22, 2026. A mandatory site meeting will be held June 25, 2026 at 10:00 AM. ' +
      'Questions must be received by July 2, 2026. Closing Date: July 9, 2026 at 2:00 PM.';
    expect(findClosingDate(text, opts)?.iso).toBe('2026-07-09T21:00:00Z');
    expect(findClosingDate('Deadline for questions: July 2, 2026. Bids close July 9, 2026 at 2:00 PM.', opts)?.iso).toBe(
      '2026-07-09T21:00:00Z',
    );
  });

  it('returns null when no date follows a closing label', () => {
    expect(findClosingDate('Issued June 22, 2026', opts)).toBeNull();
    expect(findClosingDate('Closing date to be announced.', opts)).toBeNull();
  });
});

describe('closingDeadline', () => {
  it('uses the exact instant for timed closings', () => {
    expect(closingDeadline('2026-07-09T21:00:00Z', 'datetime').toISOString()).toBe('2026-07-09T21:00:00.000Z');
  });
  it('uses the start of the local day for date-only closings', () => {
    expect(closingDeadline('2026-07-10T06:59:59Z', 'date').toISOString()).toBe('2026-07-09T07:00:00.000Z');
  });
});

describe('formatLocal', () => {
  it('formats in Pacific time', () => {
    expect(formatLocal('2026-07-09T21:00:00Z', 'datetime')).toBe('Thu, Jul 9, 2026 at 2:00 PM PDT');
    expect(formatLocal('2026-07-10T06:59:59Z', 'date')).toBe('Thu, Jul 9, 2026');
    expect(formatLocal(null)).toBe('');
  });
});
