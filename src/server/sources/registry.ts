import { sourceConfigSchema, type SourceConfig, type SourceKind, type SourceRecord } from '../../shared/schemas.js';
import { HttpError } from '../http/client.js';
import { bonfire } from './connectors/bonfire.js';
import { CANADABUYS_OPEN_CSV, canadabuysCsv } from './connectors/canadabuysCsv.js';
import { CANADABUYS_SEARCH_URL, canadabuysSearch } from './connectors/canadabuysSearch.js';
import { htmlList, rss } from './connectors/web.js';
import type { Connector, ConnectorContext, SourceOutcome } from './types.js';

const CONNECTORS: Record<SourceKind, Connector> = {
  canadabuys_csv: canadabuysCsv,
  canadabuys_search: canadabuysSearch,
  bonfire,
  rss,
  html_list: htmlList,
};

export function connectorFor(kind: SourceKind): Connector {
  return CONNECTORS[kind];
}

export interface DefaultSource {
  id: string;
  name: string;
  kind: SourceKind;
  notes: string;
  config: SourceConfig;
}

function source(id: string, name: string, kind: SourceKind, notes: string, config: Partial<SourceConfig>): DefaultSource {
  return { id, name, kind, notes, config: sourceConfigSchema.parse(config) };
}

/**
 * The bid sources that ship with the app, taken from each buyer's public
 * procurement pages.
 *
 * These could not be exercised against the live sites while the app was being
 * written, so treat the first run as the test: the Sources page shows, for
 * each one, whether it answered and how many notices were read. The Victoria,
 * Saanich and Central Saanich portal addresses follow Bonfire's usual naming
 * (the North Saanich and UVic ones are published by those buyers).
 *
 * Greater Victoria bodies that are not listed separately (Langford, Colwood,
 * View Royal, Sidney, Sooke, Metchosin, Highlands, the school districts,
 * Camosun, Royal Roads, BC Transit, BC Housing ...) post on BC Bid, and are
 * picked up through the "BC Bid notices" source.
 */
export const DEFAULT_SOURCES: DefaultSource[] = [
  source(
    'canadabuys-bcbid',
    'BC Bid notices (via CanadaBuys)',
    'canadabuys_search',
    'Notices from BC Bid, where most Greater Victoria municipalities, school districts and public bodies post. BC Bid itself puts a browser check in front of its listing, so its notices are read from the CanadaBuys site, which republishes them.',
    { url: CANADABUYS_SEARCH_URL, bcOnly: true, timeZone: 'America/Toronto', fetchDetails: true },
  ),
  source(
    'canadabuys-federal',
    'Government of Canada tenders (open data)',
    'canadabuys_csv',
    'Every open federal tender, from the official daily open-data file. Covers National Defence (CFB Esquimalt), Parks Canada, Fisheries and Oceans and federal buildings in the region.',
    { url: CANADABUYS_OPEN_CSV, timeZone: 'America/Toronto', fetchDetails: false },
  ),
  source('bonfire-victoria', 'City of Victoria — bid portal', 'bonfire', 'The City of Victoria’s Bonfire portal. Bids are submitted on the portal with a free vendor account.', {
    url: 'https://victoria.bonfirehub.ca',
    organization: 'City of Victoria',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
  }),
  source('bonfire-saanich', 'District of Saanich — procurement portal', 'bonfire', 'The Saanich Procurement Portal (Bonfire). All Saanich documents, addenda and submissions go through it.', {
    url: 'https://saanich.bonfirehub.ca',
    organization: 'District of Saanich',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
  }),
  source('saanich-rss', 'District of Saanich — bid opportunities feed', 'rss', 'Saanich’s own website feed. It includes smaller quotation requests that are not posted on BC Bid.', {
    url: 'https://www.saanich.ca/EN/main/business/selling-to-saanich/bid-opportunities/data/tenders.rss',
    organization: 'District of Saanich',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: true,
  }),
  source('bonfire-centralsaanich', 'District of Central Saanich — procurement portal', 'bonfire', 'Central Saanich’s Bonfire portal.', {
    url: 'https://centralsaanich.bonfirehub.ca',
    organization: 'District of Central Saanich',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
  }),
  source('bonfire-northsaanich', 'District of North Saanich — procurement portal', 'bonfire', 'North Saanich’s Bonfire portal.', {
    url: 'https://northsaanich.bonfirehub.ca',
    organization: 'District of North Saanich',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
  }),
  source('bonfire-uvic', 'University of Victoria — procurement portal', 'bonfire', 'UVic’s Euna Procurement (Bonfire) portal.', {
    url: 'https://uvic.bonfirehub.ca',
    organization: 'University of Victoria',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
  }),
  source('crd', 'Capital Regional District — current opportunities', 'html_list', 'The CRD’s bid site. Work on Salt Spring, the Gulf Islands and Port Renfrew is filtered out as outside Greater Victoria.', {
    url: 'https://bid.crd.ca/contracts-rfps/current',
    linkPattern: '^/contracts-rfps/current/[^/?#]+',
    organization: 'Capital Regional District',
    localBuyer: true,
    fetchDetails: true,
  }),
  source('esquimalt', 'Township of Esquimalt — bids & tenders', 'html_list', 'Esquimalt’s own bids page.', {
    url: 'https://www.esquimalt.ca/business-development/bids-tenders',
    linkPattern: '^/business-development/bids-tenders/[^/?#]+',
    organization: 'Township of Esquimalt',
    localBuyer: true,
    fetchDetails: true,
  }),
  source('oakbay', 'District of Oak Bay — tenders', 'html_list', 'Oak Bay’s tenders page. Oak Bay posts its documents on BC Bid, so this page is often empty.', {
    url: 'https://oakbay.ca/municipal-hall/tenders-grants/tenders',
    organization: 'District of Oak Bay',
    localBuyer: true,
    defaultSubmission: 'bcbid',
    fetchDetails: true,
  }),
  source(
    'civicinfo-bc',
    'CivicInfo BC — local government bids',
    'html_list',
    'A province-wide listing used by BC local governments, including smaller Greater Victoria municipalities. Notices from elsewhere in BC are filtered out.',
    { url: 'https://www.civicinfo.bc.ca/bids', pageParam: 'pn', pageStart: 1, maxPages: 5, bcOnly: true, fetchDetails: true },
  ),
];

const EMPTY_HINT =
  'Nothing is listed right now. That is normal when the buyer has nothing open; if it stays empty while the site clearly shows opportunities, the page has changed — use “Test” to see what is being read.';

/** Read one source's listing and classify how it went. Never throws. */
export async function listSource(record: SourceRecord, ctx: ConnectorContext): Promise<SourceOutcome> {
  const started = Date.now();
  const notes: string[] = [];
  const context: ConnectorContext = { ...ctx, note: (message) => notes.push(message) };
  try {
    const result = await connectorFor(record.kind).list(record, context);
    const message = notes.join(' ');
    if (result.unchanged) {
      return { status: 'ok', message: message || 'No change since the last run.', items: [], unchanged: true, state: result.state, ms: Date.now() - started };
    }
    if (result.items.length === 0) {
      return { status: 'empty', message: [message, EMPTY_HINT].filter(Boolean).join(' '), items: [], unchanged: false, state: result.state, ms: Date.now() - started };
    }
    return { status: 'ok', message, items: result.items, unchanged: false, state: result.state, ms: Date.now() - started };
  } catch (error) {
    const blocked = error instanceof HttpError && error.blocked;
    const message = error instanceof Error ? error.message : String(error);
    return { status: blocked ? 'blocked' : 'error', message, items: [], unchanged: false, ms: Date.now() - started };
  }
}
