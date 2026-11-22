import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from '../src/server/db/store.js';
import { openDatabase } from '../src/server/db/database.js';
import { extractAward, isOwnCompany } from '../src/server/matching/award.js';
import { createPipeline } from '../src/server/pipeline/run.js';
import { sourceConfigSchema } from '../src/shared/schemas.js';
import { makeEnv, type Env } from './helpers/pipelineEnv.js';

// MAT-16 on invented samples (summer dates: Pacific is UTC-7).
const start = new Date('2026-06-15T20:00:00Z');
const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000);

describe('extractAward', () => {
  it('reads the winner, amount and date from "awarded to"', () => {
    expect(
      extractAward('RFQ 26-201 Boulevard Mowing Services has been awarded to Garry Oak Grounds Ltd. for $48,500.00 (excluding GST). Awarded on June 3, 2026.'),
    ).toEqual({
      winner: 'Garry Oak Grounds Ltd.',
      amount: 48_500,
      amountText: '$48,500.00 (excluding GST)',
      awardedOn: '2026-06-03',
      excerpt: 'RFQ 26-201 Boulevard Mowing Services has been awarded to Garry Oak Grounds Ltd. for $48,500.00 (excluding GST).',
    });
  });

  it('reads "successful proponent" and an amount in another sentence', () => {
    const a = extractAward('The successful proponent is Coastal Turf & Gardens Inc. The contract value is $1.2 million.');
    expect(a).toMatchObject({ winner: 'Coastal Turf & Gardens Inc.', amount: 1_200_000, awardedOn: null });
  });

  it('reads labelled fields', () => {
    const a = extractAward('Awarded to: Sample Landscaping Co.\nAward date: 2026-06-10\nTotal: $12,000');
    expect(a).toMatchObject({ winner: 'Sample Landscaping Co.', amount: 12_000, awardedOn: '2026-06-10' });
  });

  it('reads "awarded the contract to" and stops at the first ordinary word', () => {
    expect(extractAward('The District awarded the contract to Westshore Parks Services on 12 June 2026.')?.winner).toBe('Westshore Parks Services');
    expect(extractAward('Contract was awarded to the firm Island Green Ltd. in the amount of $95,000.')).toMatchObject({ winner: 'Island Green Ltd.', amount: 95_000 });
  });

  it('returns null when nothing names a winner or an amount', () => {
    expect(extractAward('Results of the tender opening: three bids were received.')).toBeNull();
    expect(extractAward('')).toBeNull();
  });

  it('matches the profile company name loosely', () => {
    expect(isOwnCompany('Garry Oak Grounds Ltd.', ['Garry Oak Grounds Ltd.'])).toBe(true);
    expect(isOwnCompany('GARRY OAK GROUNDS LIMITED', ['Garry Oak Grounds'])).toBe(true);
    expect(isOwnCompany('Coastal Turf & Gardens Inc.', ['Garry Oak Grounds Ltd.', 'Garry Oak Grounds'])).toBe(false);
    expect(isOwnCompany('', ['Garry Oak Grounds'])).toBe(false);
  });
});

describe('linking an award notice (store)', () => {
  it('links by reference key on the same source and never treats another award as the original', () => {
    const store = createStore(openDatabase(':memory:'));
    store.insertSource({ id: 'site', name: 'Site', kind: 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, start);
    const base = { organization: 'District of Saanich', closing: { iso: '2026-07-09T21:00:00Z', precision: 'datetime' as const } };
    const original = store.upsertOpportunity('site', { ...base, externalId: '1', title: 'RFQ 26-201 Boulevard Mowing Services', url: 'https://saanich.example/1' }, true, start);
    const award = store.upsertOpportunity('site', { ...base, externalId: '2', title: 'Award Notice - RFQ 26-201 Mowing', url: 'https://saanich.example/2' }, true, at(1));
    expect(store.getOpportunity(award.id)!.status).toBe('awarded');
    expect(store.findAwardOriginal(award.id)).toBe(original.id);
    // Linking by title when no reference matches.
    const other = store.upsertOpportunity('site', { ...base, externalId: '3', title: 'Cemetery Grass Cutting', url: 'https://saanich.example/3' }, true, at(2));
    const otherAward = store.upsertOpportunity('site', { ...base, externalId: '4', title: 'Contract Award: Cemetery Grass Cutting', url: 'https://saanich.example/4' }, true, at(3));
    expect(store.findAwardOriginal(otherAward.id)).toBe(other.id);

    const saved = store.recordParsedAward(
      { originalId: original.id, noticeId: award.id, winner: 'Coastal Turf Ltd.', amount: 40_000, amountText: '$40,000', awardedOn: '2026-06-10', excerpt: 'x', awarded: true },
      at(4),
    )!;
    expect(saved).toMatchObject({ opportunityId: original.id, noticeOpportunityId: award.id, origin: 'parsed', status: 'suggested', winner: 'Coastal Turf Ltd.' });
    expect(store.getOpportunity(original.id)!.status).toBe('awarded');
    expect(store.listChanges(original.id).map((c) => c.kind)).toContain('status_changed');

    // A confirmed result is the user's: a later notice does not overwrite it.
    store.saveAward({ ...saved, status: 'confirmed', origin: 'manual' }, at(5));
    const again = store.recordParsedAward(
      { originalId: original.id, noticeId: award.id, winner: 'Someone Else Inc.', amount: null, amountText: '', awardedOn: null, excerpt: '', awarded: true },
      at(6),
    )!;
    expect(again).toMatchObject({ status: 'confirmed', winner: 'Coastal Turf Ltd.' });
    expect(store.listAwards()).toHaveLength(1);
  });

  it('never links last year\'s award to this year\'s bid by title when the references differ', () => {
    const store = createStore(openDatabase(':memory:'));
    store.insertSource({ id: 'site', name: 'Site', kind: 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, start);
    const base = { organization: 'District of Saanich', closing: { iso: '2026-07-09T21:00:00Z', precision: 'datetime' as const } };
    const open = store.upsertOpportunity('site', { ...base, externalId: '1', title: 'RFQ 26-010 Boulevard Mowing', url: 'https://saanich.example/1' }, true, start);
    const award = store.upsertOpportunity('site', { ...base, externalId: '2', title: 'Award: Boulevard Mowing (RFQ 25-090)', url: 'https://saanich.example/2', closing: null }, true, at(1));
    expect(store.findAwardOriginal(award.id)).toBeNull();
    expect(store.getOpportunity(open.id)!.status).toBe('open');
  });

  it('ends a bid linked by title alone only once its closing has passed', () => {
    const store = createStore(openDatabase(':memory:'));
    store.insertSource({ id: 'site', name: 'Site', kind: 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, start);
    const org = { organization: 'District of Saanich' };
    const open = store.upsertOpportunity('site', { ...org, externalId: '1', title: 'RFQ 26-010 Boulevard Mowing', url: 'https://saanich.example/1', closing: { iso: '2026-07-09T21:00:00Z', precision: 'datetime' } }, true, start);
    const award = store.upsertOpportunity('site', { ...org, externalId: '2', title: 'Award: Boulevard Mowing', url: 'https://saanich.example/2', closing: null }, true, at(1));
    expect(store.findAwardOriginal(award.id)).toBe(open.id);
    const input = { originalId: open.id, noticeId: award.id, winner: 'Coastal Turf Ltd.', amount: 40_000, amountText: '$40,000', awardedOn: null, excerpt: 'x', awarded: true };
    store.recordParsedAward(input, at(2));
    expect(store.getOpportunity(open.id)!.status).toBe('open');
    // After the closing (2:00 PM on 9 July, Pacific) the same notice ends the bid.
    store.recordParsedAward(input, new Date('2026-07-10T18:00:00Z'));
    expect(store.getOpportunity(open.id)!.status).toBe('awarded');
  });
});

describe('award notices in a run (MAT-16)', () => {
  let server: Server;
  let base = '';
  const site = { award: false, awardText: 'RFQ 26-201 Boulevard Mowing Services has been awarded to Garry Oak Grounds Ltd. for $48,500.00 (excluding GST).', unrelated: false };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '';
      const html = (body: string) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<html><body><main>${body}</main></body></html>`);
      if (url === '/site/list') {
        const items = ['<li><a href="/site/notice/1">RFQ 26-201 Boulevard Mowing Services</a> Closing July 9, 2026 2:00 PM</li>'];
        if (site.award) items.push('<li><a href="/site/notice/2">Award Notice - RFQ 26-201 Boulevard Mowing Services</a></li>');
        if (site.unrelated) {
          items.push('<li><a href="/site/notice/3">Award Notice - RFQ 26-450 Boulevard Grass Cutting Area 4</a></li>');
          items.push('<li><a href="/site/notice/4">Award Notice - ITT 26-500 Watermain Replacement</a></li>');
        }
        return html(`<ul>${items.join('')}</ul>`);
      }
      if (url === '/site/notice/1')
        return html('<h1>RFQ 26-201 Boulevard Mowing Services</h1><p>The District of Saanich invites quotations for boulevard mowing and grass cutting.</p><p>Closing date: July 9, 2026 2:00 PM</p><p>Submit by e-mail to purchasing@saanich.example.</p>');
      if (url === '/site/notice/2') return html(`<h1>Award Notice - RFQ 26-201 Boulevard Mowing Services</h1><p>${site.awardText}</p>`);
      if (url === '/site/notice/3')
        return html('<h1>Award Notice - RFQ 26-450 Boulevard Grass Cutting Area 4</h1><p>Boulevard grass cutting in Saanich was awarded to Coastal Turf Ltd. for $22,000.</p>');
      if (url === '/site/notice/4')
        return html('<h1>Award Notice - ITT 26-500 Watermain Replacement</h1><p>The watermain replacement was awarded to Pipe Works Inc. for $900,000.</p>');
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    site.award = false;
    site.unrelated = false;
    site.awardText = 'RFQ 26-201 Boulevard Mowing Services has been awarded to Garry Oak Grounds Ltd. for $48,500.00 (excluding GST).';
  });

  const env = (mode = 'prepare'): Env =>
    makeEnv({
      noSamples: true,
      automation: { mode },
      extraSources: [
        { id: 'site', name: 'Saanich site', kind: 'html_list', config: { url: `${base}/site/list`, linkPattern: '^/site/notice/\\d+$', organization: 'District of Saanich', localBuyer: true } },
      ],
    });
  const runAt = (e: Env, hours: number) => {
    e.clock.now = at(hours);
    return createPipeline(e.deps).run('manual');
  };
  const byTitle = (e: Env, title: string) => e.store.listOpportunities({ view: 'all', limit: 50 }, e.clock.now).items.find((o) => o.title === title);

  it('marks the original awarded and never drafts it when the award comes in the same run', async () => {
    site.award = true;
    const e = env();
    await runAt(e, 0);
    const original = byTitle(e, 'RFQ 26-201 Boulevard Mowing Services')!;
    expect(original.status).toBe('awarded');
    expect(e.store.getApplicationByOpportunity(original.id)).toBeUndefined();
    const award = e.store.getAwardFor(original.id)!;
    expect(award).toMatchObject({ winner: 'Garry Oak Grounds Ltd.', amount: 48_500, origin: 'parsed', status: 'suggested' });
    expect(award.noticeOpportunityId).not.toBeNull();
  });

  it('suggests a win from the profile name without changing the application, and keeps the suggestion unconfirmed', async () => {
    const e = env('discover');
    await runAt(e, 0);
    const original = byTitle(e, 'RFQ 26-201 Boulevard Mowing Services')!;
    const app = e.store.createApplication(
      {
        opportunityId: original.id,
        status: 'submitted',
        channel: 'email',
        toEmail: 'purchasing@saanich.example',
        ccEmail: '',
        subject: 'Submission',
        body: 'Hello',
        includeRates: false,
        checklist: [],
        documentIds: [],
        missing: [],
        autoGenerated: false,
      },
      e.clock.now,
    );
    site.award = true;
    await runAt(e, 2);
    expect(e.store.getOpportunity(original.id)!.status).toBe('awarded');
    expect(e.store.getApplication(app.id)!.status).toBe('submitted');
    expect(e.store.getAwardFor(original.id)!.status).toBe('suggested');
    const note = e.store.listEvents(100).find((ev) => ev.kind === 'award_suggested')!;
    expect(note.applicationId).toBe(app.id);
    expect(note.message).toContain('looks like a win');

    // Another company named: a "probably not won" suggestion.
    site.award = false;
    const e2 = env('discover');
    await runAt(e2, 0);
    const o2 = byTitle(e2, 'RFQ 26-201 Boulevard Mowing Services')!;
    e2.store.setUserDecision(o2.id, 'pursue');
    e2.store.createApplication({ ...app, opportunityId: o2.id }, e2.clock.now);
    site.award = true;
    site.awardText = 'The successful proponent is Coastal Turf & Gardens Inc. The contract value is $51,000.';
    await runAt(e2, 2);
    expect(e2.store.listEvents(100).find((ev) => ev.kind === 'award_suggested')!.message).toContain('probably not won');
  });

  it('keeps awards for in-area relevant notices with no original, and not for unrelated work (D13)', async () => {
    site.unrelated = true;
    const e = env('discover');
    await runAt(e, 0);
    const awards = e.store.listAwards();
    expect(awards.map((a) => a.winner)).toEqual(['Coastal Turf Ltd.']);
    expect(awards[0]).toMatchObject({ opportunityId: null, status: 'suggested', amount: 22_000 });
  });
});
