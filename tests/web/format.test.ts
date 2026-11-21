import { describe, expect, it } from 'vitest';
import { closingText, daysUntilPlainDate, emailProblem, formatBytes, formatDuration, formatMoney, plural } from '../../src/web/format.js';

// Web helpers run under tests/web/tsconfig.json (DOM and vite/client types, Bundler resolution).
const zone = 'America/Vancouver';
const now = new Date('2026-06-15T20:00:00Z');

describe('web format helpers', () => {
  it('writes counts, sizes and durations as people read them', () => {
    expect(plural(1, 'bid')).toBe('1 bid');
    expect(plural(3, 'bid')).toBe('3 bids');
    expect(plural(2, 'company', 'companies')).toBe('2 companies');
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatDuration(250)).toBe('250 ms');
    expect(formatDuration(42_000)).toBe('42 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatMoney(null)).toBe('Not entered');
  });

  it('explains what is wrong with an e-mail address', () => {
    expect(emailProblem('')).toBeUndefined();
    expect(emailProblem('office@garryoak.example')).toBeUndefined();
    expect(emailProblem('office @example.com')).toMatch(/spaces/);
    expect(emailProblem('office@example')).toMatch(/full e-mail address/);
  });

  it('counts days to a plain date in the business time zone', () => {
    expect(daysUntilPlainDate('2026-06-20', zone, now)).toBe(5);
    expect(daysUntilPlainDate('2026-06-14', zone, now)).toBe(-1);
    expect(daysUntilPlainDate('June 20', zone, now)).toBeNull();
  });

  it('describes a closing date', () => {
    expect(closingText(null, null, 'Friday at noon', zone, now)).toMatchObject({ relative: 'Closing date not stated', absolute: 'Notice says: Friday at noon', past: false });
    expect(closingText('2026-06-17T21:00:00Z', 'datetime', '', zone, now)).toMatchObject({ past: false, soon: true });
    expect(closingText('2026-06-01T21:00:00Z', 'datetime', '', zone, now)).toMatchObject({ past: true, soon: false });
    expect(closingText('2026-07-10T06:59:59Z', 'date', '', zone, now).absolute).toMatch(/time not stated$/);
  });
});
