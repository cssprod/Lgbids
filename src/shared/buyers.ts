/**
 * Greater Victoria public buyers and where each one posts its bids.
 *
 * Pure data: the coverage view, the live-check kit and the alert reader all
 * use it. `certainty` says how sure we are of the channels: `verified` was
 * checked against the live site, `code` is what the readers already handle,
 * `unconfirmed` is a guess the live-check kit should confirm. `candidateUrls`
 * are unconfirmed pages that only the kit probes (robots first).
 */

/** `page:<sourceId>`, `bcbid`, `bonfire:<sub>`, `bidsandtenders:<sub>`, `canadabuys` or `civicinfo`. */
export type BuyerChannel =
  | `page:${string}`
  | 'bcbid'
  | `bonfire:${string}`
  | `bidsandtenders:${string}`
  | 'canadabuys'
  | 'civicinfo';

export type BuyerCertainty = 'verified' | 'code' | 'unconfirmed';
export type BuyerKind = 'municipality' | 'regional' | 'school' | 'post_secondary' | 'health' | 'crown' | 'federal' | 'provincial';

export interface Buyer {
  id: string;
  name: string;
  kind: BuyerKind;
  aliases: string[];
  channels: BuyerChannel[];
  certainty: BuyerCertainty;
  /** One sentence telling the user how to hear about this buyer's bids. */
  setupHint: string;
  candidateUrls: string[];
}

const BCBID_HINT = 'Turn on BC Bid e-mail notifications for grounds and landscaping commodities to hear about its bids.';
const bonfireHint = (name: string) => `Follow ${name} on Bonfire so its new-opportunity e-mails reach your alert inbox.`;

export const BUYERS: Buyer[] = [
  // The 13 municipalities.
  { id: 'victoria', name: 'City of Victoria', kind: 'municipality', aliases: ['Victoria', 'Corporation of the City of Victoria'], channels: ['bonfire:victoria', 'bcbid'], certainty: 'code', setupHint: bonfireHint('the City of Victoria'), candidateUrls: [] },
  { id: 'saanich', name: 'District of Saanich', kind: 'municipality', aliases: ['Saanich', 'Corporation of the District of Saanich'], channels: ['page:saanich-rss', 'bonfire:saanich', 'bcbid'], certainty: 'verified', setupHint: 'Lgbids reads the Saanich feed; also follow Saanich on Bonfire for its larger bids.', candidateUrls: [] },
  { id: 'esquimalt', name: 'Township of Esquimalt', kind: 'municipality', aliases: ['Esquimalt', 'Corporation of the Township of Esquimalt'], channels: ['page:esquimalt', 'bcbid'], certainty: 'verified', setupHint: 'Lgbids reads the Esquimalt bids page; keep that source turned on.', candidateUrls: [] },
  { id: 'oakbay', name: 'District of Oak Bay', kind: 'municipality', aliases: ['Oak Bay', 'Corporation of the District of Oak Bay'], channels: ['page:oakbay', 'bcbid'], certainty: 'unconfirmed', setupHint: 'Oak Bay posts its documents on BC Bid, so turn on BC Bid notifications as well as the Oak Bay page.', candidateUrls: ['https://www.oakbay.ca/business/bids-tenders'] },
  { id: 'centralsaanich', name: 'District of Central Saanich', kind: 'municipality', aliases: ['Central Saanich'], channels: ['bonfire:centralsaanich', 'bcbid'], certainty: 'code', setupHint: bonfireHint('Central Saanich'), candidateUrls: [] },
  { id: 'northsaanich', name: 'District of North Saanich', kind: 'municipality', aliases: ['North Saanich'], channels: ['bonfire:northsaanich', 'bcbid'], certainty: 'code', setupHint: bonfireHint('North Saanich'), candidateUrls: [] },
  { id: 'sidney', name: 'Town of Sidney', kind: 'municipality', aliases: ['Sidney'], channels: ['page:sidney', 'bidsandtenders:sidney', 'bcbid'], certainty: 'unconfirmed', setupHint: 'Follow Sidney on bids&tenders so its bid e-mails reach your alert inbox.', candidateUrls: ['https://sidney.bidsandtenders.ca'] },
  { id: 'langford', name: 'City of Langford', kind: 'municipality', aliases: ['Langford'], channels: ['page:langford', 'bcbid'], certainty: 'unconfirmed', setupHint: 'Turn on the Langford page and BC Bid notifications to hear about its bids.', candidateUrls: [] },
  { id: 'colwood', name: 'City of Colwood', kind: 'municipality', aliases: ['Colwood'], channels: ['page:colwood', 'bcbid'], certainty: 'unconfirmed', setupHint: 'Turn on the Colwood page and BC Bid notifications to hear about its bids.', candidateUrls: [] },
  { id: 'viewroyal', name: 'Town of View Royal', kind: 'municipality', aliases: ['View Royal'], channels: ['page:viewroyal', 'bcbid'], certainty: 'unconfirmed', setupHint: 'Turn on the View Royal page and BC Bid notifications to hear about its bids.', candidateUrls: [] },
  { id: 'sooke', name: 'District of Sooke', kind: 'municipality', aliases: ['Sooke'], channels: ['page:sooke', 'bcbid'], certainty: 'unconfirmed', setupHint: 'Turn on the Sooke page and BC Bid notifications to hear about its bids.', candidateUrls: [] },
  { id: 'metchosin', name: 'District of Metchosin', kind: 'municipality', aliases: ['Metchosin'], channels: ['bcbid', 'civicinfo'], certainty: 'unconfirmed', setupHint: BCBID_HINT, candidateUrls: ['https://www.metchosin.ca'] },
  { id: 'highlands', name: 'District of Highlands', kind: 'municipality', aliases: ['Highlands'], channels: ['bcbid', 'civicinfo'], certainty: 'unconfirmed', setupHint: BCBID_HINT, candidateUrls: ['https://www.highlands.ca'] },
  // Regional and public bodies.
  { id: 'crd', name: 'Capital Regional District', kind: 'regional', aliases: ['CRD', 'Capital Region Housing Corporation', 'CRHC', 'Capital Regional Hospital District', 'CRHD'], channels: ['page:crd', 'bcbid'], certainty: 'unconfirmed', setupHint: 'The old CRD bids site is gone, so turn on BC Bid notifications until the new page is confirmed.', candidateUrls: ['https://www.crd.ca/about/doing-business-crd'] },
  { id: 'sd61', name: 'School District No. 61 (Greater Victoria)', kind: 'school', aliases: ['SD61', 'Greater Victoria School District'], channels: ['bcbid'], certainty: 'unconfirmed', setupHint: BCBID_HINT, candidateUrls: [] },
  { id: 'sd62', name: 'School District No. 62 (Sooke)', kind: 'school', aliases: ['SD62', 'Sooke School District'], channels: ['bcbid'], certainty: 'unconfirmed', setupHint: BCBID_HINT, candidateUrls: [] },
  { id: 'sd63', name: 'School District No. 63 (Saanich)', kind: 'school', aliases: ['SD63', 'Saanich School District', 'Saanich Schools'], channels: ['bcbid'], certainty: 'unconfirmed', setupHint: BCBID_HINT, candidateUrls: [] },
  { id: 'uvic', name: 'University of Victoria', kind: 'post_secondary', aliases: ['UVic'], channels: ['bonfire:uvic', 'bcbid'], certainty: 'code', setupHint: bonfireHint('the University of Victoria'), candidateUrls: [] },
  { id: 'camosun', name: 'Camosun College', kind: 'post_secondary', aliases: ['Camosun'], channels: ['bonfire:camosun', 'bcbid'], certainty: 'unconfirmed', setupHint: bonfireHint('Camosun College'), candidateUrls: [] },
  { id: 'royalroads', name: 'Royal Roads University', kind: 'post_secondary', aliases: ['Royal Roads', 'RRU'], channels: ['bonfire:royalroads', 'bcbid'], certainty: 'unconfirmed', setupHint: bonfireHint('Royal Roads University'), candidateUrls: [] },
  { id: 'islandhealth', name: 'Island Health', kind: 'health', aliases: ['Vancouver Island Health Authority', 'VIHA'], channels: ['bcbid'], certainty: 'unconfirmed', setupHint: BCBID_HINT, candidateUrls: [] },
  { id: 'bchousing', name: 'BC Housing', kind: 'crown', aliases: ['British Columbia Housing Management Commission'], channels: ['bcbid'], certainty: 'unconfirmed', setupHint: BCBID_HINT, candidateUrls: [] },
  { id: 'yyj', name: 'Victoria Airport Authority', kind: 'regional', aliases: ['Victoria International Airport', 'YYJ'], channels: ['bcbid'], certainty: 'unconfirmed', setupHint: 'Check BC Bid notifications; the airport may also post on its own website.', candidateUrls: ['https://www.victoriaairport.com'] },
  { id: 'bcferries', name: 'BC Ferries', kind: 'crown', aliases: ['British Columbia Ferry Services', 'BC Ferry Services Inc.'], channels: ['bcbid'], certainty: 'unconfirmed', setupHint: 'BC Ferries runs its own supplier portal; register there and check BC Bid notifications too.', candidateUrls: ['https://www.bcferries.com'] },
  // Federal and provincial buyers.
  { id: 'dnd', name: 'Department of National Defence', kind: 'federal', aliases: ['DND', 'National Defence', 'Defence Construction Canada', 'DCC', 'CFB Esquimalt'], channels: ['canadabuys'], certainty: 'unconfirmed', setupHint: 'Save a CanadaBuys search for Greater Victoria grounds work and turn on its e-mail alerts.', candidateUrls: [] },
  { id: 'parkscanada', name: 'Parks Canada', kind: 'federal', aliases: ['Parks Canada Agency'], channels: ['canadabuys'], certainty: 'unconfirmed', setupHint: 'Save a CanadaBuys search for Greater Victoria grounds work and turn on its e-mail alerts.', candidateUrls: [] },
  { id: 'bcministries', name: 'Province of British Columbia (ministries)', kind: 'provincial', aliases: ['Government of British Columbia', 'Ministry of Transportation and Infrastructure', 'BC Parks'], channels: ['bcbid'], certainty: 'code', setupHint: BCBID_HINT, candidateUrls: [] },
];

export const MUNICIPALITY_IDS = BUYERS.filter((b) => b.kind === 'municipality').map((b) => b.id);
