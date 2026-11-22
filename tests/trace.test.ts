import { describe, expect, it } from 'vitest';
import { automationSchema, profileSchema } from '../src/shared/schemas.js';
import { analyse, type AnalyseInput } from '../src/server/matching/analyse.js';
import { assessArea, defaultRegion } from '../src/server/matching/geo.js';
import { classifyNoticeEvent, detectNoticeType, detectNoticeTypeTraced } from '../src/server/matching/notice.js';
import { assessRelevance, LEXICON_VERSION } from '../src/server/matching/relevance.js';

const region = defaultRegion();
const now = new Date('2026-06-15T20:00:00Z');
const zone = 'America/Vancouver';

describe('rule trace (MAT-2)', () => {
  it('gives each area branch its own rule id', () => {
    const area = (title: string, organization = '', extra: { location?: string; description?: string; bcSource?: boolean; localSource?: boolean } = {}) =>
      assessArea({ title, organization, location: extra.location ?? '', description: extra.description ?? '', localSource: !!extra.localSource, bcSource: !!extra.bcSource }, region).rule;
    expect(area('Park mowing', 'District of Saanich')).toBe('area.local_buyer');
    expect(area('Park mowing in Nanaimo', 'District of Saanich')).toBe('area.local_buyer_excluded_title');
    expect(area('Park mowing', 'District of Saanich', { location: 'Nanaimo' })).toBe('area.local_buyer_excluded_location');
    expect(area('Mowing at Langford parks', 'BC Ministry', { bcSource: true })).toBe('area.place');
    expect(area('Mowing in Nanaimo', 'BC Ministry', { bcSource: true })).toBe('area.excluded_place');
    expect(area('Mowing', 'City of Kamloops', { bcSource: true })).toBe('area.nonlocal_government');
    expect(area('Mowing Toronto, Ontario', 'Acme')).toBe('area.other_province');
    expect(area('Mowing', 'BC Ministry', { bcSource: true, description: 'Head office in Victoria.' })).toBe('area.description_victoria');
    expect(area('Mowing', 'BC Ministry', { bcSource: true, description: 'Work at sites in Langford.' })).toBe('area.description_place');
    expect(area('Mowing', 'BC Ministry', { bcSource: true })).toBe('area.bc_unplaced');
    expect(area('Mowing', 'Acme')).toBe('area.not_local');
  });

  it('records mask hits and a stable lexicon version', () => {
    const r = assessRelevance({ title: 'Wastewater treatment plant upgrades' });
    expect(r.maskHits.length).toBeGreaterThan(0);
    expect(LEXICON_VERSION).toMatch(/^[0-9a-f]{8}$/);
    expect(LEXICON_VERSION).toBe(LEXICON_VERSION);
  });

  it('puts a code on every analyse reason and a trace on the analysis', () => {
    const base: AnalyseInput = {
      title: 'RFQ 26-123 - Yard Maintenance Services', organization: 'Some Ministry', description: '', location: '', categories: [],
      noticeTypeHint: '', closesAt: '2026-07-09T21:00:00Z', closesAtPrecision: 'datetime', status: 'open', url: '', documentText: '',
      localSource: false, bcSource: true, sourceSubmission: 'unknown',
    };
    const ctx = { profile: profileSchema.parse({}), automation: automationSchema.parse({}), region, now, zone };
    const r = analyse(base, ctx);
    expect(r.analysis.reasons.every((x) => typeof x.code === 'string' && x.code.length > 0)).toBe(true);
    expect(r.analysis.trace?.lexiconVersion).toBe(LEXICON_VERSION);
    expect(r.analysis.trace?.typeRule).toBe('type.title_keyword');
    expect(r.analysis.trace?.areaRule).toBe('area.bc_unplaced');
    expect(r.analysis.trace?.matches.length).toBeGreaterThan(0);
    const none = analyse({ ...base, title: 'Office Paper Supply' }, ctx);
    expect(none.analysis.reasons.some((x) => x.code === 'relevance.none')).toBe(true);
    const cancelled = analyse({ ...base, title: 'CANCELLED - RFQ 26-151 Hedge Trimming Services' }, ctx);
    expect(cancelled.decision).toBe('unsuitable');
    expect(cancelled.analysis.reasons.some((x) => x.code === 'type.cancelled')).toBe(true);
  });
});

describe('notice type fixes and events (MAT-3)', () => {
  it('ignores future-tense award wording and negated sole-source in the description', () => {
    expect(detectNoticeType('Lawn Mowing Services', 'The contract will be awarded to the lowest compliant quotation. Quotations are invited.')).toBe('RFQ');
    expect(detectNoticeType('Boulevard Mowing', 'This is an open competition and not a sole-source award. Quotations are invited.')).toBe('RFQ');
    expect(detectNoticeType('Boulevard Mowing', 'The contract has been awarded to Acme Ltd.')).toBe('AWARD');
    expect(detectNoticeType('Award: Park Mowing')).not.toBe('NOI');
  });

  it('treats results titles as awards and says which rule decided', () => {
    expect(detectNoticeTypeTraced('Bid Results - RFQ 26-140 Landscape Maintenance')).toEqual({ type: 'AWARD', rule: 'type.result_title' });
    expect(detectNoticeTypeTraced('Results: ITT 26-07 Sports Field Mowing').type).toBe('AWARD');
    expect(detectNoticeTypeTraced('Mowing').rule).toBe('type.none');
  });

  it('classifies notice events', () => {
    expect(classifyNoticeEvent('CANCELLED - RFQ 26-151 Hedge Trimming')).toBe('cancellation');
    expect(classifyNoticeEvent('Bid Results - RFQ 26-140 Mowing')).toBe('result');
    expect(classifyNoticeEvent('Results: ITT 26-07 Mowing')).toBe('result');
    expect(classifyNoticeEvent('Notice of Award - Park Mowing')).toBe('award');
    expect(classifyNoticeEvent('Addendum 2 - RFQ 26-151 Hedge Trimming')).toBe('addendum');
    expect(classifyNoticeEvent('RFQ 26-151 Hedge Trimming', 'Quotes will be awarded to the lowest bidder.')).toBe('notice');
  });
});
