import { describe, expect, it } from 'vitest';
import type { Opportunity } from '../src/shared/schemas.js';
import { CSV_BOM, csvCell, OPPORTUNITY_CSV_HEADERS, opportunitiesCsvName, opportunitiesCsvText, toCsv } from '../src/server/util/csv.js';

describe('csv cells', () => {
  it('quotes only when needed and doubles inner quotes', () => {
    expect(csvCell('Lawn mowing')).toBe('Lawn mowing');
    expect(csvCell('Parks, boulevards')).toBe('"Parks, boulevards"');
    expect(csvCell('The "Gorge" park')).toBe('"The ""Gorge"" park"');
    expect(csvCell('Line one\nline two')).toBe('"Line one\nline two"');
    expect(csvCell('Ends with CR\r')).toBe('"Ends with CR\r"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(82)).toBe('82');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('keeps text from bid sites from running as a spreadsheet formula', () => {
    expect(csvCell('=HYPERLINK("https://evil.example","Click")')).toBe(`"'=HYPERLINK(""https://evil.example"",""Click"")"`);
    expect(csvCell('+1 250 555 0100')).toBe("'+1 250 555 0100");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    // Only the first character matters, and numbers are left alone.
    expect(csvCell('Lot 2 = phase two')).toBe('Lot 2 = phase two');
    expect(csvCell(-5)).toBe('-5');
  });

  it('writes a BOM and CRLF line ends so Excel opens it as UTF-8', () => {
    const text = toCsv([
      ['a', 'b'],
      ['Café', 'Saanich'],
    ]);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text).toBe(`${CSV_BOM}a,b\r\nCafé,Saanich\r\n`);
  });
});

function opp(overrides: Partial<Opportunity>): Opportunity {
  return {
    title: 'Boulevard mowing',
    organization: 'District of Saanich',
    sourceName: 'Saanich feed',
    referenceNumber: 'RFQ 26-14',
    noticeType: 'RFQ',
    decision: 'suitable',
    userDecision: null,
    suitabilityScore: 82,
    closesAt: '2026-07-02T21:00:00Z',
    closesAtPrecision: 'datetime',
    submissionMethod: 'email',
    submissionEmail: 'bids@saanich.example',
    url: 'https://saanich.example/bids/14',
    firstSeenAt: '2026-06-15T16:30:00Z',
    ...overrides,
  } as Opportunity;
}

describe('opportunities export', () => {
  it('has the agreed columns, local times and readable labels', () => {
    const text = opportunitiesCsvText(
      [opp({}), opp({ title: 'Hedge, trimming', userDecision: 'pursue', closesAt: '2026-07-10T06:59:59Z', closesAtPrecision: 'date', submissionMethod: 'bonfire', submissionEmail: '' }), opp({ decision: null, suitabilityScore: null, closesAt: null, closesAtPrecision: null })],
      'America/Vancouver',
    );
    const lines = text.slice(CSV_BOM.length).split('\r\n');
    expect(lines[0]).toBe(OPPORTUNITY_CSV_HEADERS.join(','));
    expect(lines[0]).toBe('Title,Buyer,Source,Reference,Type,Decision,Score,Closes,Submission,Link,First seen,Winner,Winning price,Awarded on,Award status');
    // 21:00Z is 2:00 PM in Victoria (UTC-7). The zone's short name depends on the tz data version.
    const zoneName = lines[1]!.match(/2:00 PM (\S+)"/)?.[1];
    expect(zoneName).toBeTruthy();
    expect(lines[1]).toBe(
      `Boulevard mowing,District of Saanich,Saanich feed,RFQ 26-14,Request for quotations,Suitable,82,"Thu, Jul 2, 2026 at 2:00 PM ${zoneName}",Email — bids@saanich.example,https://saanich.example/bids/14,"Mon, Jun 15, 2026 at 9:30 AM ${zoneName}",,,,`,
    );
    expect(lines[2]).toMatch(/^"Hedge, trimming",.*,Pursuing,82,"Thu, Jul 9, 2026",Bonfire/);
    expect(lines[3]).toMatch(/,Not scored yet,,Not stated,/);
    expect(lines[4]).toBe('');
  });

  it('is named after the local day, not the UTC one', () => {
    // 9 PM in Victoria on June 30 is already July 1 in UTC.
    expect(opportunitiesCsvName(new Date('2026-07-01T04:00:00Z'), 'America/Vancouver')).toBe('lgbids-opportunities-2026-06-30.csv');
  });
});
