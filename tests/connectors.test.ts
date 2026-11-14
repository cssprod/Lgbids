import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sourceConfigSchema, type SourceConfig, type SourceKind, type SourceRecord } from '../src/shared/schemas.js';
import { startFixtureServer, type FixtureServer } from '../src/server/demo/server.js';
import { HttpClient, HttpError, looksLikeChallenge } from '../src/server/http/client.js';
import { isAllowed, parseRobots } from '../src/server/http/robots.js';
import { defaultRegion } from '../src/server/matching/geo.js';
import { findProjects, portalBase } from '../src/server/sources/connectors/bonfire.js';
import { indexColumns } from '../src/server/sources/connectors/canadabuysCsv.js';
import { extractDetail, extractListing, parseFeed } from '../src/server/sources/extract.js';
import { connectorFor, DEFAULT_SOURCES, listSource } from '../src/server/sources/registry.js';
import type { ConnectorContext, RawOpportunity } from '../src/server/sources/types.js';

// Mid-June: every sample closing date lands in summer, where Pacific time is
// UTC-7 whichever version of the time zone rules the runtime carries.
const now = new Date('2026-06-15T20:00:00Z');
let server: FixtureServer;
let http: HttpClient;
let ctx: ConnectorContext;

function source(kind: SourceKind, config: Partial<SourceConfig>, name = 'Test source'): SourceRecord {
  return {
    id: 'test',
    name,
    kind,
    enabled: true,
    builtin: false,
    notes: '',
    config: sourceConfigSchema.parse(config),
    lastRunAt: null,
    lastOkAt: null,
    lastStatus: 'never',
    lastMessage: '',
    lastItemCount: null,
    consecutiveFailures: 0,
  };
}

beforeAll(async () => {
  server = await startFixtureServer(now);
  http = new HttpClient({ userAgent: 'LgbidsTest/1.0', respectRobots: true, delayMs: 0, retries: 0 });
  ctx = { http, now, region: defaultRegion(), state: {}, note: () => undefined };
});

afterAll(async () => {
  await server.close();
});

const byTitle = (items: RawOpportunity[], fragment: string) => items.find((i) => i.title.includes(fragment));

describe('CanadaBuys open-data CSV', () => {
  it('keeps only rows that could be local landscaping work', async () => {
    const outcome = await listSource(source('canadabuys_csv', { url: `${server.url}/canadabuys/opendata/open.csv` }), ctx);
    expect(outcome.status).toBe('ok');
    const titles = outcome.items.map((i) => i.title);
    expect(titles).toContain('Grounds Maintenance Services – CFB Esquimalt, Dockyard and Naden');
    expect(titles).toContain('Vegetation Management – Fort Rodd Hill and Fisgard Lighthouse National Historic Sites');
    // British Columbia, but not Greater Victoria: kept here, ruled out later by the area check.
    expect(titles).toContain('Landscaping and Snow Removal – RCMP Detachment, Prince George');
    // Not landscaping, and not in British Columbia, respectively.
    expect(titles).not.toContain('Janitorial Services – Institute of Ocean Sciences, Sidney');
    expect(titles).not.toContain('Grass Cutting Services – Rideau Canal Lockstations');
    expect(outcome.message).toContain('Read 5 federal notices');
  });

  it('maps the columns of a notice', async () => {
    const { items } = await listSource(source('canadabuys_csv', { url: `${server.url}/canadabuys/opendata/open.csv` }), ctx);
    const item = byTitle(items, 'CFB Esquimalt')!;
    expect(item).toMatchObject({
      externalId: 'cb-771-90000101',
      referenceNumber: 'W0103-26GM01/A',
      organization: 'Department of National Defence',
      contactEmail: 'contracting.officer@canada.example',
      status: 'open',
      bcSource: true,
    });
    expect(item.noticeTypeHint).toContain('Request for Standing Offer');
    expect(item.categories).toContain('UNSPSC 70111706 Lawn care services');
    expect(item.location).toContain('CFB Esquimalt');
    // 2:00 pm Pacific on 9 July, written in the file as 17:00 with no zone (Eastern).
    expect(item.closing).toEqual({ iso: '2026-07-09T21:00:00Z', precision: 'datetime' });
    expect(item.description).toContain('as-and-when-requested');
  });

  it('skips the download when the file has not changed', async () => {
    const record = source('canadabuys_csv', { url: `${server.url}/canadabuys/opendata/open.csv` });
    const first = await listSource(record, ctx);
    expect(first.state).toMatchObject({ etag: '"sample-1"' });
    const second = await listSource(record, { ...ctx, state: first.state! });
    expect(second).toMatchObject({ status: 'ok', unchanged: true, items: [] });
  });

  it('finds columns by their English stem', () => {
    const index = indexColumns(['title-titre-eng', 'title-titre-fra', 'unspsc', 'tenderStatus-tenderStatut-eng', 'noticeURL-URLavis-eng']);
    expect(index.get('title')).toBe('title-titre-eng');
    expect(index.get('title:fra')).toBe('title-titre-fra');
    expect(index.get('unspsc')).toBe('unspsc');
    expect(index.get('tenderstatus')).toBe('tenderStatus-tenderStatut-eng');
    expect(index.get('noticeurl')).toBe('noticeURL-URLavis-eng');
  });
});

describe('CanadaBuys search (mirrored BC Bid notices)', () => {
  const record = () =>
    source('canadabuys_search', {
      url: `${server.url}/canadabuys/en/tender-opportunities?search_filter={query}&words={query}`,
      queries: ['landscape', 'mowing', 'grounds', 'turf', 'parks'],
      bcOnly: true,
      timeZone: 'America/Toronto',
    });

  it('collects notices across search terms without duplicates', async () => {
    const outcome = await listSource(record(), ctx);
    expect(outcome.status).toBe('ok');
    const ids = outcome.items.map((i) => i.externalId).sort();
    expect(ids).toEqual(['bc900101', 'bc900102', 'bc900103', 'bc900104', 'bc900105', 'bc900106']);
    const langford = outcome.items.find((i) => i.externalId === 'bc900102')!;
    expect(langford).toMatchObject({
      title: 'ITT PRK-26-07 - Sports Field Mowing and Turf Maintenance',
      organization: 'City of Langford',
      referenceNumber: 'PRK-26-07',
      bcSource: true,
    });
    expect(langford.url).toBe(`${server.url}/canadabuys/en/tender-opportunities/tender-notice/bc900102`);
    // The listing shows only the closing day.
    expect(langford.closing).toMatchObject({ precision: 'date' });
    expect(langford.closing!.iso.slice(0, 10)).toBe('2026-07-01');
  });

  it('reads a notice page for the description, exact closing time and contact', async () => {
    const outcome = await listSource(record(), ctx);
    const langford = outcome.items.find((i) => i.externalId === 'bc900102')!;
    const detail = await connectorFor('canadabuys_search').detail!(record(), langford, ctx);
    expect(detail).toMatchObject({
      organization: 'City of Langford',
      referenceNumber: 'PRK-26-07',
      contactEmail: 'parks@langford.example',
      bcSource: true,
    });
    // 2:00 pm Pacific, shown on the page as 17:00 EDT.
    expect(detail!.closing).toEqual({ iso: '2026-06-30T21:00:00Z', precision: 'datetime' });
    expect(detail!.description).toContain('Tenders must be submitted electronically through BC Bid');
    expect(detail!.location).toContain('British Columbia');
  });
});

describe('Bonfire portal', () => {
  it('reads the open opportunities listing', async () => {
    const outcome = await listSource(
      source('bonfire', { url: `${server.url}/bonfire/saanich`, organization: 'District of Saanich', localBuyer: true, defaultSubmission: 'bonfire' }),
      ctx,
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.items).toHaveLength(4);
    const item = byTitle(outcome.items, 'Boulevard')!;
    expect(item).toMatchObject({
      externalId: '181001',
      referenceNumber: 'RFQ 26-140',
      organization: 'District of Saanich',
      url: `${server.url}/bonfire/saanich/opportunities/181001`,
      status: 'open',
    });
    // 2:00 pm Pacific on 4 July = 21:00 UTC; the portal value is UTC.
    expect(item.closing).toEqual({ iso: '2026-07-04T21:00:00Z', precision: 'datetime' });
  });

  it('accepts whatever portal address was pasted', () => {
    expect(portalBase('uvic.bonfirehub.ca/portal')).toBe('https://uvic.bonfirehub.ca');
    expect(portalBase('https://northsaanich.bonfirehub.ca/opportunities')).toBe('https://northsaanich.bonfirehub.ca');
    expect(portalBase('https://victoria.bonfirehub.ca/opportunities/12345')).toBe('https://victoria.bonfirehub.ca');
    expect(portalBase('https://saanich.bonfirehub.ca/portal/?tab=openOpportunities')).toBe('https://saanich.bonfirehub.ca');
  });

  it('finds projects in other response shapes', () => {
    expect(findProjects({ success: 1, payload: { projects: [{ ProjectID: '1', ProjectName: 'A' }] } })).toHaveLength(1);
    expect(findProjects({ data: [{ id: 5, title: 'B' }, { id: 6, title: 'C' }] })).toHaveLength(2);
    expect(findProjects({ success: 1, payload: { projects: {} } })).toEqual([]);
    expect(findProjects('<html>')).toEqual([]);
  });

  it('reports a portal that does not answer with JSON', async () => {
    const outcome = await listSource(source('bonfire', { url: `${server.url}/empty/listing` }), ctx);
    expect(outcome.status).toBe('error');
  });
});

describe('RSS feed', () => {
  const record = () =>
    source('rss', { url: `${server.url}/saanich/tenders.rss`, organization: 'District of Saanich', localBuyer: true, defaultSubmission: 'bonfire' });

  it('reads feed entries with their closing dates', async () => {
    const outcome = await listSource(record(), ctx);
    expect(outcome.status).toBe('ok');
    expect(outcome.items.map((i) => i.title)).toEqual([
      'Boulevard and Median Landscape Maintenance',
      'Yard Maintenance Services',
      'Rock Wall Construction',
      'Arboricultural Services',
    ]);
    const yard = byTitle(outcome.items, 'Yard Maintenance')!;
    expect(yard.url).toBe(`${server.url}/saanich/bid-opportunities/yard-maintenance-services.html`);
    expect(yard.organization).toBe('District of Saanich');
    expect(yard.closing).toEqual({ iso: '2026-06-28T21:00:00Z', precision: 'datetime' });
    expect(yard.publishedAt).toBe('2026-06-11T16:00:00Z');
  });

  it('opens the notice page for the full text', async () => {
    const outcome = await listSource(record(), ctx);
    const yard = byTitle(outcome.items, 'Yard Maintenance')!;
    const detail = await connectorFor('rss').detail!(record(), yard, ctx);
    expect(detail!.description).toContain('Quotations must be submitted by email to quotes@saanich.example');
    expect(detail!.closing).toEqual({ iso: '2026-06-28T21:00:00Z', precision: 'datetime' });
  });

  it('parses Atom feeds too', () => {
    const feed = parseFeed(
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Bids</title>
       <entry><title>RFP 1 - Mowing</title><link rel="alternate" href="/bids/1"/><id>tag:1</id><updated>2026-06-01T10:00:00Z</updated><summary type="html">&lt;p&gt;Closes July 9, 2026&lt;/p&gt;</summary></entry></feed>`,
      'https://example.org/feed',
    );
    expect(feed.title).toBe('Bids');
    expect(feed.items[0]).toMatchObject({ id: 'tag:1', title: 'RFP 1 - Mowing', link: 'https://example.org/bids/1', description: 'Closes July 9, 2026' });
  });

  it('rejects an address that is not a feed', async () => {
    const outcome = await listSource(source('rss', { url: `${server.url}/empty/listing` }), ctx);
    expect(outcome).toMatchObject({ status: 'error', message: 'The address did not return an RSS or Atom feed.' });
  });
});

describe('web page listing', () => {
  it('follows a link pattern (Capital Regional District style cards)', async () => {
    const record = source('html_list', {
      url: `${server.url}/crd/contracts-rfps/current`,
      linkPattern: '^/crd/contracts-rfps/current/[^/?#]+',
      organization: 'Capital Regional District',
      localBuyer: true,
    });
    const outcome = await listSource(record, ctx);
    expect(outcome.status).toBe('ok');
    expect(outcome.items).toHaveLength(4);
    const mowing = byTitle(outcome.items, 'Regional Parks Mowing')!;
    expect(mowing).toMatchObject({
      title: '2026-041 - ITQ - Regional Parks Mowing and Trimming Services',
      referenceNumber: '2026-041',
      organization: 'Capital Regional District',
    });
    expect(mowing.closing).toEqual({ iso: '2026-07-01T21:00:00Z', precision: 'datetime' });
    // "Awarded" and "Closed" navigation links are not notices.
    expect(outcome.items.some((i) => /awarded|closed/i.test(i.title))).toBe(false);

    const detail = await connectorFor('html_list').detail!(record, mowing, ctx);
    expect(detail!.documents).toEqual([{ name: '2026-041 Invitation to Quote (PDF)', url: `${server.url}/crd/documents/2026-041-itq.pdf` }]);
    expect(detail!.status).toBe('open');
    expect(detail!.contactEmail).toBe('parks.procurement@crd.example');
  });

  it('reads a table with column headers (Esquimalt style)', async () => {
    const outcome = await listSource(
      source('html_list', {
        url: `${server.url}/esquimalt/business-development/bids-tenders`,
        linkPattern: '^/esquimalt/business-development/bids-tenders/[^/?#]+',
        organization: 'Township of Esquimalt',
        localBuyer: true,
      }),
      ctx,
    );
    expect(outcome.items).toHaveLength(2);
    const garden = byTitle(outcome.items, 'Garden Maintenance')!;
    expect(garden.referenceNumber).toBe('P&R 26-04');
    expect(garden.closing).toEqual({ iso: '2026-06-27T21:00:00Z', precision: 'datetime' });
    expect(garden.status).toBe('open');
  });

  it('works out the rows by itself and pages through a listing (CivicInfo BC style)', async () => {
    const outcome = await listSource(
      source('html_list', { url: `${server.url}/civicinfo/bids`, pageParam: 'pn', pageStart: 1, maxPages: 5, bcOnly: true }),
      ctx,
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.items.map((i) => i.title)).toEqual([
      'Landscape Maintenance Services',
      'Cemetery Grounds Maintenance',
      'Water Main Replacement Program',
      'Street Tree Planting and Establishment Watering',
      'Parks Mowing Services',
      'Community Hall Roof Replacement',
    ]);
    const cemetery = byTitle(outcome.items, 'Cemetery')!;
    expect(cemetery).toMatchObject({ organization: 'District of Metchosin', noticeTypeHint: 'Request for Quotations', externalId: '/civicinfo/bids?bidsid=7002' });
    expect(cemetery.closing).toMatchObject({ precision: 'date' });
    expect(cemetery.closing!.iso.slice(0, 10)).toBe('2026-06-30');
    expect(outcome.message).toContain('6 notices on 3 pages');
  });

  it('reports an empty page as empty, not as a failure', async () => {
    const outcome = await listSource(source('html_list', { url: `${server.url}/empty/listing` }), ctx);
    expect(outcome.status).toBe('empty');
    expect(outcome.message).toContain('Nothing is listed right now');
  });
});

describe('extractListing on other layouts', () => {
  const opts = { zone: 'America/Vancouver', now };

  it('reads a plain list of links with dates', () => {
    const html = `<main><h1>Bid Opportunities</h1><ul>
      <li><a href="/bids/rfp-2026-07-boulevard-mowing">RFP 2026-07 Boulevard Mowing</a> - closes July 9, 2026 at 2:00 PM</li>
      <li><a href="/bids/itt-2026-08-watermain">ITT 2026-08 Watermain Replacement</a> - closes July 16, 2026 at 2:00 PM</li>
    </ul><p><a href="/bids/archive">Previous tenders</a></p></main>`;
    const items = extractListing(html, 'https://town.example/bids', opts);
    expect(items.map((i) => [i.title, i.referenceNumber, i.closing?.iso])).toEqual([
      ['RFP 2026-07 Boulevard Mowing', '2026-07', '2026-07-09T21:00:00Z'],
      ['ITT 2026-08 Watermain Replacement', '2026-08', '2026-07-16T21:00:00Z'],
    ]);
  });

  it('uses the heading when the link text is generic', () => {
    const html = `<main><div class="card"><h3>Request for Quotations: Cemetery Mowing</h3><p>Closing Date: July 9, 2026</p><a href="/tenders/55">View details</a></div>
      <div class="card"><h3>Request for Proposals: Audit Services</h3><p>Closing Date: July 10, 2026</p><a href="/tenders/56">View details</a></div></main>`;
    const items = extractListing(html, 'https://town.example/tenders', opts);
    expect(items.map((i) => i.title)).toEqual(['Request for Quotations: Cemetery Mowing', 'Request for Proposals: Audit Services']);
    expect(items[0]!.url).toBe('https://town.example/tenders/55');
  });

  it('honours an explicit row selector', () => {
    const html = `<div class="bid"><span class="name">Park Mowing 2026</span><a href="/docs/park-mowing.pdf">Download</a><em>Due: July 9, 2026</em></div>`;
    const items = extractListing(html, 'https://town.example/bids', { ...opts, itemSelector: '.bid' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ url: 'https://town.example/docs/park-mowing.pdf' });
    expect(items[0]!.closing).toMatchObject({ precision: 'date' });
  });

  it('ignores navigation, paging and mail links', () => {
    const html = `<nav><a href="/tenders/old">Tender archive</a></nav><main><p>No current opportunities.</p>
      <a href="mailto:bids@town.example">Email the tender office</a> <a href="/tenders?page=2">Next</a></main>`;
    expect(extractListing(html, 'https://town.example/tenders', opts)).toEqual([]);
  });
});

describe('extractDetail', () => {
  it('reads labelled fields, the closing date and documents', () => {
    const html = `<html><head><title>RFP 26-01 Mowing | Town</title></head><body><nav><a href="/x.pdf">Menu PDF</a></nav><main>
      <h1>RFP 26-01 Mowing</h1>
      <p><strong>Closing Date:</strong> July 9, 2026 at 2:00 PM</p>
      <p><strong>Contact:</strong> Jane Buyer, jane.buyer@town.example, 250-555-0199</p>
      <p>Proposals are invited for mowing.</p>
      <a href="/files/rfp-26-01.pdf">RFP document</a> <a href="/about">About</a></main></body></html>`;
    const detail = extractDetail(html, 'https://town.example/bids/rfp-26-01', { zone: 'America/Vancouver', now });
    expect(detail.title).toBe('RFP 26-01 Mowing');
    expect(detail.closing).toEqual({ iso: '2026-07-09T21:00:00Z', precision: 'datetime' });
    expect(detail.referenceNumber).toBe('26-01');
    expect(detail.contactName).toBe('Jane Buyer,');
    expect(detail.contactEmail).toBe('jane.buyer@town.example');
    expect(detail.contactPhone).toBe('250-555-0199');
    expect(detail.documents).toEqual([{ name: 'RFP document', url: 'https://town.example/files/rfp-26-01.pdf' }]);
    expect(detail.description).toContain('Proposals are invited for mowing.');
  });
});

describe('HTTP client behaviour', () => {
  it('obeys robots.txt', async () => {
    await expect(http.get(`${server.url}/private/listing`)).rejects.toMatchObject({ blocked: true });
    const outcome = await listSource(source('html_list', { url: `${server.url}/private/listing` }), ctx);
    expect(outcome.status).toBe('blocked');
    expect(outcome.message).toContain('robots.txt');
  });

  it('can be told to ignore robots.txt', async () => {
    const rude = new HttpClient({ userAgent: 'LgbidsTest/1.0', respectRobots: false, delayMs: 0, retries: 0 });
    await expect(rude.get(`${server.url}/private/listing`)).resolves.toMatchObject({ status: 200 });
  });

  it('classifies refusals and bot checks as blocked', async () => {
    const refused = await listSource(source('html_list', { url: `${server.url}/blocked/listing` }), ctx);
    expect(refused).toMatchObject({ status: 'blocked', message: 'The site refused the request (HTTP 403).' });
    const challenged = await listSource(source('html_list', { url: `${server.url}/challenge/listing` }), ctx);
    expect(challenged).toMatchObject({ status: 'blocked', message: 'The site showed a bot check instead of the page.' });
  });

  it('reports missing pages and unreachable sites as errors', async () => {
    const missing = await listSource(source('html_list', { url: `${server.url}/nowhere` }), ctx);
    expect(missing).toMatchObject({ status: 'error', message: 'The site answered with an error (HTTP 404).' });
    const dead = await listSource(source('html_list', { url: 'http://127.0.0.1:9/bids' }), ctx);
    expect(dead.status).toBe('error');
  });

  it('refuses non-web addresses', async () => {
    await expect(http.get('file:///etc/passwd')).rejects.toBeInstanceOf(HttpError);
  });

  it('spaces out requests to the same host', async () => {
    const slow = new HttpClient({ userAgent: 'LgbidsTest/1.0', respectRobots: false, delayMs: 120, retries: 0 });
    const started = Date.now();
    await Promise.all([slow.get(`${server.url}/empty/listing`), slow.get(`${server.url}/empty/listing`), slow.get(`${server.url}/empty/listing`)]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(230);
  });

  it('recognises challenge pages but not ordinary pages with a captcha widget', () => {
    expect(looksLikeChallenge('<html><head><title>Just a moment...</title></head><body></body></html>')).toBe(true);
    expect(looksLikeChallenge('<html><body><main><table><tr><td>RFP</td></tr></table><div class="g-recaptcha"></div></main></body></html>')).toBe(false);
  });
});

describe('robots.txt rules', () => {
  const groups = parseRobots(`
    User-agent: *
    Disallow: /search
    Disallow: /*?sort=
    Allow: /search/public
    Disallow: /private/$

    User-agent: BadBot
    Disallow: /
  `);
  it('applies the longest matching rule', () => {
    expect(isAllowed(groups, 'Lgbids/0.1', '/bids')).toBe(true);
    expect(isAllowed(groups, 'Lgbids/0.1', '/search?q=x')).toBe(false);
    expect(isAllowed(groups, 'Lgbids/0.1', '/search/public/page')).toBe(true);
    expect(isAllowed(groups, 'Lgbids/0.1', '/bids?sort=date')).toBe(false);
    expect(isAllowed(groups, 'Lgbids/0.1', '/private/')).toBe(false);
    expect(isAllowed(groups, 'Lgbids/0.1', '/private/file')).toBe(true);
  });
  it('uses a group written for this agent', () => {
    expect(isAllowed(groups, 'BadBot/2.0', '/bids')).toBe(false);
  });
  it('treats an empty file as allow-all', () => {
    expect(isAllowed(parseRobots(''), 'Lgbids/0.1', '/anything')).toBe(true);
  });
});

describe('default sources', () => {
  it('are all valid and uniquely named', () => {
    const ids = DEFAULT_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of DEFAULT_SOURCES) {
      expect(s.config.url, s.id).toMatch(/^https:\/\//);
      expect(connectorFor(s.kind).kind).toBe(s.kind);
      if (s.config.linkPattern) expect(() => new RegExp(s.config.linkPattern)).not.toThrow();
    }
  });
});
