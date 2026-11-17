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
  /** False for a site that refuses automated reading; it ships turned off. */
  enabled?: boolean;
}

function source(id: string, name: string, kind: SourceKind, notes: string, config: Partial<SourceConfig>, enabled = true): DefaultSource {
  return { id, name, kind, notes, config: sourceConfigSchema.parse(config), enabled };
}

const BONFIRE_OFF =
  'Turned off: Bonfire portals ask automated tools not to read them (their robots.txt disallows everything), so Lgbids leaves them alone. To hear about new bids, register a free vendor account on the portal and follow this buyer; Bonfire then e-mails you new opportunities.';
const CANADABUYS_OFF =
  'Turned off: canadabuys.canada.ca asks automated tools other than search engines not to read it (robots.txt), so Lgbids leaves it alone.';

/**
 * The bid sources that ship with the app, taken from each buyer's public
 * procurement pages.
 *
 * Checked against the live sites on 2026-11-17. The District of Saanich feed
 * and the Township of Esquimalt page read correctly. CanadaBuys and every
 * Bonfire portal disallow automated reading in robots.txt, and CivicInfo BC
 * puts a Cloudflare browser check in front of its listing, so those ship
 * turned off with a note saying how to follow them by hand. The old CRD bid
 * site no longer answers, and Oak Bay's page could not be reached from the
 * development environment (see each source's note).
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
    `${CANADABUYS_OFF} BC Bid itself puts a browser check in front of its listing. Most Greater Victoria municipalities, school districts and public bodies post on BC Bid: turn on BC Bid's own e-mail notifications for landscaping categories to hear about them.`,
    { url: CANADABUYS_SEARCH_URL, bcOnly: true, timeZone: 'America/Toronto', fetchDetails: true },
    false,
  ),
  source(
    'canadabuys-federal',
    'Government of Canada tenders (open data)',
    'canadabuys_csv',
    `${CANADABUYS_OFF} Federal work in the region (CFB Esquimalt, Parks Canada, federal buildings) is posted there: set up a saved search with e-mail alerts on CanadaBuys to hear about it.`,
    { url: CANADABUYS_OPEN_CSV, timeZone: 'America/Toronto', fetchDetails: false },
    false,
  ),
  source(
    'bonfire-victoria',
    'City of Victoria — bid portal',
    'bonfire',
    BONFIRE_OFF,
    {
    url: 'https://victoria.bonfirehub.ca',
    organization: 'City of Victoria',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
    },
    false,
  ),
  source(
    'bonfire-saanich',
    'District of Saanich — procurement portal',
    'bonfire',
    BONFIRE_OFF,
    {
    url: 'https://saanich.bonfirehub.ca',
    organization: 'District of Saanich',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
    },
    false,
  ),
  source('saanich-rss', 'District of Saanich — bid opportunities feed', 'rss', 'Saanich’s own website feed. It includes smaller quotation requests that are not posted on BC Bid.', {
    url: 'https://www.saanich.ca/EN/main/business/selling-to-saanich/bid-opportunities/data/tenders.rss',
    organization: 'District of Saanich',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: true,
  }),
  source(
    'bonfire-centralsaanich',
    'District of Central Saanich — procurement portal',
    'bonfire',
    BONFIRE_OFF,
    {
    url: 'https://centralsaanich.bonfirehub.ca',
    organization: 'District of Central Saanich',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
    },
    false,
  ),
  source(
    'bonfire-northsaanich',
    'District of North Saanich — procurement portal',
    'bonfire',
    BONFIRE_OFF,
    {
    url: 'https://northsaanich.bonfirehub.ca',
    organization: 'District of North Saanich',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
    },
    false,
  ),
  source(
    'bonfire-uvic',
    'University of Victoria — procurement portal',
    'bonfire',
    BONFIRE_OFF,
    {
    url: 'https://uvic.bonfirehub.ca',
    organization: 'University of Victoria',
    localBuyer: true,
    defaultSubmission: 'bonfire',
    fetchDetails: false,
    },
    false,
  ),
  source(
    'crd',
    'Capital Regional District — current opportunities',
    'html_list',
    'Turned off: the CRD’s old bid site (bid.crd.ca) now answers “not found” for every page, and its replacement on crd.ca could not be checked yet. Look at the CRD’s current opportunities on crd.ca until this source is updated. Work on Salt Spring, the Gulf Islands and Port Renfrew is filtered out as outside Greater Victoria.',
    {
    url: 'https://bid.crd.ca/contracts-rfps/current',
    linkPattern: '^/contracts-rfps/current/[^/?#]+',
    organization: 'Capital Regional District',
    localBuyer: true,
    fetchDetails: true,
    },
    false,
  ),
  source('esquimalt', 'Township of Esquimalt — bids & tenders', 'html_list', 'Esquimalt’s own bids page.', {
    url: 'https://www.esquimalt.ca/business-development/bids-tenders',
    linkPattern: '^/business-development/bids-tenders/[^/?#]+',
    organization: 'Township of Esquimalt',
    localBuyer: true,
    fetchDetails: true,
  }),
  source('oakbay', 'District of Oak Bay — tenders', 'html_list', 'Oak Bay’s tenders page (oakbay.ca now forwards to www.oakbay.ca; not yet checked against the live page). Oak Bay posts its documents on BC Bid, so this page is often empty.', {
    url: 'https://www.oakbay.ca/municipal-hall/tenders-grants/tenders',
    organization: 'District of Oak Bay',
    localBuyer: true,
    defaultSubmission: 'bcbid',
    fetchDetails: true,
  }),
  source(
    'civicinfo-bc',
    'CivicInfo BC — local government bids',
    'html_list',
    'Turned off: CivicInfo BC puts a Cloudflare browser check in front of its bid listing, so it cannot be read automatically. Smaller Greater Victoria municipalities post there; check civicinfo.bc.ca/bids in your browser.',
    { url: 'https://www.civicinfo.bc.ca/bids', pageParam: 'pn', pageStart: 1, maxPages: 5, bcOnly: true, fetchDetails: true },
    false,
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
