import { describe, expect, it } from 'vitest';
import { evalContext } from '../src/server/matching/evaluate.js';
import { scoringInsights, titleNgrams, type TuningInput } from '../src/server/matching/tuning.js';
import type { FeedbackRecord, TraceMatch } from '../src/shared/schemas.js';

let nextId = 1;
function fb(over: Partial<FeedbackRecord> & { matches?: TraceMatch[]; areaRule?: string }): FeedbackRecord {
  const { matches = [], areaRule = 'area.local_buyer', ...rest } = over;
  return {
    id: nextId++,
    opportunityId: null,
    verdict: 'not_relevant',
    reasons: [],
    note: '',
    title: 'Untitled',
    url: '',
    organization: 'District of Saanich',
    foundVia: '',
    sourceId: 'saanich',
    noticeType: 'RFQ',
    score: 80,
    decision: 'suitable',
    matchedTerms: matches.map((m) => m.term),
    services: ['lawn'],
    area: 'yes',
    areaMatch: 'Saanich',
    trace: { lexiconVersion: 'v1', areaRule, typeRule: 'type.title_keyword', maskHits: [], matches },
    lexiconVersion: 'v1',
    createdAt: '2026-07-01T17:00:00Z',
    ...rest,
  };
}

function run(feedback: FeedbackRecord[], excludeKeywords: string[] = []): ReturnType<typeof scoringInsights> {
  const ctx = evalContext();
  const input: TuningInput = { feedback, notices: new Map(), profile: ctx.profile, automation: { ...ctx.automation, excludeKeywords }, region: ctx.region, now: new Date('2026-07-02T17:00:00Z'), days: 30, since: '2026-06-02T17:00:00Z' };
  return scoringInsights(input);
}

const mowingTitle: TraceMatch = { term: 'mowing', service: 'lawn', strength: 3, where: 'title' };
const turfBody: TraceMatch = { term: 'turf', service: 'lawn', strength: 2, where: 'body' };

describe('tuning report (MAT-13)', () => {
  it('is empty with no feedback', () => {
    const r = run([]);
    expect(r.counts).toEqual({ total: 0, notRelevant: 0, missed: 0 });
    expect(r.suggestions).toEqual([]);
  });

  it('attributes false positives to terms, decisive or supporting, title or body', () => {
    const items = [fb({ title: 'Janitorial and mowing', matches: [mowingTitle, turfBody] }), fb({ title: 'Mowing equipment', matches: [mowingTitle] }), fb({ verdict: 'missed', title: 'Hedge trimming', matches: [] })];
    const r = run(items);
    expect(r.counts).toEqual({ total: 3, notRelevant: 2, missed: 1 });
    const mowing = r.terms.find((t) => t.term === 'mowing')!;
    expect(mowing).toMatchObject({ falsePositives: 2, decisive: 2, supporting: 0, inTitle: 2, inBody: 0 });
    expect(mowing.examples.map((e) => e.feedbackId)).toEqual([items[0]!.id, items[1]!.id]);
    expect(r.terms.find((t) => t.term === 'turf')).toMatchObject({ falsePositives: 1, supporting: 1, inBody: 1 });
    expect(r.areaRules[0]).toMatchObject({ key: 'area.local_buyer', label: 'Local buyer', notRelevant: 2, missed: 1 });
    expect(r.typeRules[0]!.key).toBe('type.title_keyword');
    expect(r.byNoticeType[0]).toMatchObject({ key: 'RFQ', notRelevant: 2, missed: 1 });
    expect(r.bySource[0]).toMatchObject({ key: 'saanich' });
    expect(r.missed.map((m) => m.title)).toEqual(['Hedge trimming']);
  });

  it('lists word groups in missed titles that no term covers, without stopwords', () => {
    expect(titleNgrams('Request for Bioswale Upkeep at the Library')).toEqual(expect.arrayContaining(['bioswale', 'upkeep', 'bioswale upkeep', 'library']));
    expect(titleNgrams('Request for Bioswale Upkeep at the Library')).not.toContain('upkeep library');
    const r = run([fb({ verdict: 'missed', title: 'Duckweed skimming, Saanich' }), fb({ verdict: 'missed', title: 'Duckweed skimming at Cedar Hill' }), fb({ verdict: 'missed', title: 'Lawn mowing' })]);
    const top = r.uncovered.find((u) => u.ngram === 'duckweed skimming')!;
    expect(top.count).toBe(2);
    expect(r.uncovered.some((u) => u.ngram === 'mowing' || u.ngram === 'lawn mowing')).toBe(false);
    expect(r.uncovered.some((u) => u.ngram === 'for' || u.ngram === 'the')).toBe(false);
  });

  it('scores every item again under the current rules', () => {
    const r = run([
      fb({ title: 'Janitorial services for city hall', decision: 'suitable' }),
      fb({ verdict: 'missed', title: 'Boulevard mowing and trimming, District of Saanich', decision: 'unsuitable', organization: 'District of Saanich' }),
      fb({ title: 'Park mowing services, Saanich', organization: 'District of Saanich', decision: 'suitable' }),
    ]);
    expect(r.rescore.items).toHaveLength(3);
    const [janitorial, missed, mowing] = r.rescore.items;
    expect(janitorial).toMatchObject({ before: 'suitable', after: 'unsuitable', fixed: true });
    expect(missed!.after).not.toBe('unsuitable');
    expect(missed!.fixed).toBe(true);
    expect(mowing!.fixed).toBe(false);
    expect(r.rescore).toMatchObject({ fixed: 2, stillWrong: 1 });
  });

  it('suggests only with at least 3 not-relevant items and a 60 % share', () => {
    const three = [1, 2, 3].map((n) => fb({ title: `Snowplow clearing lot ${n}`, matches: [turfBody], reasons: ['outside_area'], areaMatch: 'Duncan' }));
    let r = run(three);
    expect(r.suggestions.find((s) => s.kind === 'exclude_keyword' && s.value === 'snowplow')).toMatchObject({ count: 3, share: 1 });
    expect(r.suggestions.find((s) => s.kind === 'term' && s.value === 'turf')).toMatchObject({ count: 3 });
    expect(r.suggestions.find((s) => s.kind === 'place' && s.value === 'Duncan')).toMatchObject({ count: 3 });
    expect(r.suggestions.every((s) => /\.$/.test(s.message))).toBe(true);

    // Two items are not enough.
    r = run(three.slice(0, 2));
    expect(r.suggestions).toEqual([]);

    // Three of six (50 %) is not enough either.
    const missed = [1, 2, 3].map((n) => fb({ verdict: 'missed', title: `Snowplow and turf work ${n}`, matches: [turfBody] }));
    r = run([...three, ...missed]);
    expect(r.suggestions.find((s) => s.value === 'snowplow')).toBeUndefined();
    expect(r.suggestions.find((s) => s.value === 'turf')).toBeUndefined();

    // Words already excluded are not suggested again; terms are never offered as excluded words.
    r = run(three, ['snowplow']);
    expect(r.suggestions.find((s) => s.kind === 'exclude_keyword' && s.value === 'snowplow')).toBeUndefined();
    const mowers = [1, 2, 3].map(() => fb({ title: 'Mowing equipment purchase', matches: [mowingTitle] }));
    expect(run(mowers).suggestions.find((s) => s.kind === 'exclude_keyword' && s.value === 'mowing')).toBeUndefined();
  });
});
