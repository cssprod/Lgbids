import { describe, expect, it } from 'vitest';
import { automationSchema, profileSchema } from '../src/shared/schemas.js';
import { analyse, type AnalyseInput } from '../src/server/matching/analyse.js';
import { defaultRegion } from '../src/server/matching/geo.js';
import { assessRelevance, RELEVANT_AT } from '../src/server/matching/relevance.js';

const rel = (title: string, description = '') => assessRelevance({ title, description });

describe('lexicon tuning (MAT-4)', () => {
  it('lets synthetic or artificial turf in the title veto lawn terms', () => {
    expect(rel('Synthetic Field Turf Replacement').services).not.toContain('lawn');
    expect(rel('Artificial Sports Field Turf and Lining').score).toBeLessThan(RELEVANT_AT);
    expect(rel('Sports Field Turf Renovation').services).toContain('lawn');
  });

  it('masks hanging-basket brackets and hangers', () => {
    expect(rel('Supply of Hanging Basket Brackets').score).toBeLessThan(RELEVANT_AT);
    expect(rel('Hanging Basket Watering and Maintenance').score).toBeGreaterThanOrEqual(RELEVANT_AT);
  });

  it('treats irrigation infrastructure as a weak hint', () => {
    for (const t of ['Irrigation Pump Station Upgrade', 'Irrigation District Annual Report', 'Irrigation Main Replacement']) {
      expect(rel(t).score, t).toBeLessThan(RELEVANT_AT);
    }
    expect(rel('Irrigation Maintenance Services').score).toBeGreaterThanOrEqual(RELEVANT_AT);
  });

  it('knows the added terms', () => {
    for (const t of [
      'Line Trimming Services',
      'Weed Whacking along Trails',
      'Planter Maintenance and Watering',
      'Bioretention Facility Maintenance',
      'Green Infrastructure Maintenance',
      'Pollinator Meadow Establishment',
      'Sprinkler Blow-out and Start-up',
      'Irrigation Winterization',
      'Aquatic Weed Harvesting',
    ]) {
      expect(rel(t).score, t).toBeGreaterThanOrEqual(RELEVANT_AT);
    }
  });
});

describe('bundled trades and equipment purchases (MAT-4, D11)', () => {
  const profile = profileSchema.parse({ legalName: 'Example Landscaping Ltd.', email: 'a@example.ca', phone: '250-555-0100' });
  const ctx = { profile, automation: automationSchema.parse({}), region: defaultRegion(), now: new Date('2026-06-15T20:00:00Z'), zone: 'America/Vancouver' };
  const base: AnalyseInput = {
    title: '', organization: 'District of Saanich', description: '', location: '', categories: [], noticeTypeHint: '',
    closesAt: '2026-07-09T21:00:00Z', closesAtPrecision: 'datetime', status: 'open', url: '', documentText: '',
    localSource: false, bcSource: true, sourceSubmission: 'unknown',
  };

  it('flags a non-landscape trade in the title and is never suitable', () => {
    for (const title of ['Janitorial Services - Municipal Hall', 'Watermain Replacement 2026', 'Playground Equipment Replacement']) {
      const r = analyse({ ...base, title, description: 'Includes landscape maintenance and lawn mowing at the site.' }, ctx);
      expect(r.analysis.reasons.map((x) => x.code), title).toContain('relevance.bundled_trade');
      expect(r.decision, title).not.toBe('suitable');
    }
  });

  it('describes an equipment purchase as such', () => {
    const r = analyse({ ...base, title: 'Purchase of Zero Turn Mowers' }, ctx);
    expect(r.analysis.reasons.map((x) => x.text).join(' ')).toMatch(/equipment or materials purchase/i);
  });
});
