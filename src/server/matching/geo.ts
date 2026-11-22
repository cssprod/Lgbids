import type { RegionSettings } from '../../shared/schemas.js';
import { escapeRegex, normalize, phraseRegex } from '../util/text.js';

/**
 * Decides whether the work in a notice is inside the service area
 * (Greater Victoria by default).
 *
 * Three kinds of evidence, strongest first:
 *   1. the buyer is a local body (City of Victoria, District of Saanich ...),
 *   2. a local place name in the title or location field,
 *   3. a local place name in the description (weak: head-office addresses
 *      in Victoria appear on notices for work all over the province).
 * A place outside the area named in the title overrides a local buyer, so
 * Capital Regional District work on Salt Spring Island is left out.
 */

/** The thirteen municipalities plus names for the region as a whole. */
export const CORE_PLACES = [
  'Victoria',
  'Saanich',
  'Central Saanich',
  'North Saanich',
  'Oak Bay',
  'Esquimalt',
  'View Royal',
  'Colwood',
  'Langford',
  'Metchosin',
  'Highlands',
  'Sooke',
  'Sidney',
  'Greater Victoria',
  'Capital Region',
  'Saanich Peninsula',
  'West Shore',
  'Westshore',
  'Western Communities',
  'South Island',
  'Southern Vancouver Island',
];

/** Neighbourhoods, parks, institutions and landmarks inside the area. */
export const LOCAL_PLACES = [
  'Brentwood Bay',
  'Saanichton',
  'Cordova Bay',
  'Gordon Head',
  'Royal Oak',
  'Broadmead',
  'Cadboro Bay',
  'Ten Mile Point',
  'Uplands',
  'James Bay',
  'Fairfield',
  'Fernwood',
  'Vic West',
  'Victoria West',
  'Burnside',
  'Gorge',
  'Tillicum',
  'Quadra',
  'Swan Lake',
  'Elk Lake',
  'Beaver Lake',
  'Prospect Lake',
  'Mount Douglas',
  'PKOLS',
  'Mount Tolmie',
  'Rithets Bog',
  'Panama Flats',
  'Colquitz',
  'Glanford',
  'Cedar Hill',
  'Beacon Hill Park',
  'Dallas Road',
  'Ogden Point',
  'Inner Harbour',
  'Clover Point',
  'Royal Roads',
  'Hatley Park',
  'Fort Rodd Hill',
  'Esquimalt Lagoon',
  'Belmont Park',
  'Happy Valley',
  'Westhills',
  'Bear Mountain',
  'Goldstream',
  'Millstream',
  'Florence Lake',
  'Glen Lake',
  'Langford Lake',
  'Thetis Lake',
  'Swartz Bay',
  'Patricia Bay',
  'Pat Bay',
  'Island View Beach',
  'Keating',
  'East Sooke',
  'Otter Point',
  'Sooke Potholes',
  'William Head',
  'Albert Head',
  'Rocky Point',
  'Work Point',
  'Naden',
  'CFB Esquimalt',
  'Victoria International Airport',
  'UVic',
  'University of Victoria',
  'Camosun',
  'Royal Jubilee',
  'Victoria General Hospital',
  'Saanich Peninsula Hospital',
  'Institute of Ocean Sciences',
  'Dominion Astrophysical Observatory',
  'Pacific Forestry Centre',
  'Legislative Precinct',
  'Government House',
  'Royal BC Museum',
  'Galloping Goose',
  'Lochside',
  'Sooke Hills',
  'Francis King',
  'Mill Hill',
  'Mount Work',
  'Hartland',
  'SEAPARC',
  'Panorama Recreation',
  'Juan de Fuca Recreation Centre',
  'Saanich Commonwealth Place',
  'Crystal Pool',
  'Royal Athletic Park',
  'Heals Range',
  'HMC Dockyard',
  'Willis Point',
  'Durrance',
  'Tod Inlet',
  'Deep Cove',
  'Dean Park',
  'Ardmore',
  'Matheson Lake',
  'Mount Wells',
  'Gorge Road Hospital',
  'Aberdeen Hospital',
];

/**
 * Names that identify Greater Victoria without any other context.
 * Everything else ("Victoria", "Sidney", "James Bay", "Fairfield") exists
 * elsewhere in Canada too and only counts next to a British Columbia cue.
 */
const UNAMBIGUOUS = new Set(
  [
    'Saanich',
    'Central Saanich',
    'North Saanich',
    'Esquimalt',
    'View Royal',
    'Colwood',
    'Metchosin',
    'Sooke',
    'Greater Victoria',
    'Saanich Peninsula',
    'Saanichton',
    'Brentwood Bay',
    'Cadboro Bay',
    'Swartz Bay',
    'East Sooke',
    'Sooke Potholes',
    'Sooke Hills',
    'CFB Esquimalt',
    'Esquimalt Lagoon',
    'Fort Rodd Hill',
    'Royal Roads',
    'UVic',
    'University of Victoria',
    'Camosun',
    'Victoria International Airport',
    'Saanich Peninsula Hospital',
    'Institute of Ocean Sciences',
    'Dominion Astrophysical Observatory',
    'Rithets Bog',
    'Galloping Goose',
    'Thetis Lake',
    'PKOLS',
    'Beacon Hill Park',
    'Royal BC Museum',
    // Local hospitals and recreation centres name one site each (D10).
    'SEAPARC',
    'Panorama Recreation',
    'Juan de Fuca Recreation Centre',
    'Saanich Commonwealth Place',
    'Crystal Pool',
    'Royal Athletic Park',
    'Heals Range',
    'HMC Dockyard',
    'Willis Point',
    'Tod Inlet',
    'Matheson Lake',
    'Gorge Road Hospital',
    'Aberdeen Hospital',
    'Royal Jubilee',
    'Victoria General Hospital',
    'Otter Point',
  ].map((p) => normalize(p)),
);

/** Places a local buyer may post work for that are outside Greater Victoria. */
export const DEFAULT_EXCLUDE_PLACES = [
  'Salt Spring',
  'Saltspring',
  'SSI',
  'Galiano',
  'Mayne Island',
  'Pender',
  'Saturna',
  'Gulf Islands',
  'Port Renfrew',
  'Jordan River',
  'Shirley',
  'Malahat',
  'Shawnigan',
  'Mill Bay',
  'Cobble Hill',
  'Duncan',
  'Cowichan',
  'Ladysmith',
  'Chemainus',
  'Nanaimo',
  'Parksville',
  'Qualicum',
  'Courtenay',
  'Comox',
  'Campbell River',
  'Port Alberni',
  'Tofino',
  'Ucluelet',
  'Port Hardy',
  'Powell River',
  'Vancouver',
  'Burnaby',
  'Surrey',
  'Richmond',
  'Coquitlam',
  'New Westminster',
  'Maple Ridge',
  'Langley',
  'Abbotsford',
  'Chilliwack',
  'Squamish',
  'Whistler',
  'Sechelt',
  'Kelowna',
  'Penticton',
  'Vernon',
  'Kamloops',
  'Prince George',
  'Prince Rupert',
  'Fort St John',
  'Dawson Creek',
  'Williams Lake',
  'Quesnel',
  'Cranbrook',
  'Castlegar',
  'Revelstoke',
  'Salmon Arm',
  'Lower Mainland',
  'Fraser Valley',
  'Okanagan',
  'Kootenay',
  'Cariboo',
  'Haida Gwaii',
];

/** Buyers whose work is in Greater Victoria by definition. */
export const DEFAULT_ORGANIZATIONS = [
  'City of Victoria',
  'District of Saanich',
  'District of Central Saanich',
  'District of North Saanich',
  'District of Oak Bay',
  'Township of Esquimalt',
  'Town of View Royal',
  'City of Colwood',
  'City of Langford',
  'District of Metchosin',
  'District of Highlands',
  'District of Sooke',
  'Town of Sidney',
  'Capital Regional District',
  'Capital Region Housing Corporation',
  'Capital Regional Hospital District',
  'University of Victoria',
  'Camosun College',
  'Royal Roads University',
  'Greater Victoria School District',
  'School District 61',
  'School District No 61',
  'Sooke School District',
  'School District 62',
  'School District No 62',
  'Sooke School District No 62',
  'Saanich School District',
  'Saanich Schools',
  'School District 63',
  'School District No 63',
  'Greater Victoria Harbour Authority',
  'Victoria Airport Authority',
  'Greater Victoria Public Library',
  'West Shore Parks and Recreation',
  'Peninsula Recreation Commission',
  'Victoria Police',
  'Saanich Police',
  'Songhees Nation',
  'Esquimalt Nation',
  'Tsartlip First Nation',
  'Tsawout First Nation',
  'Pauquachin First Nation',
  'Tseycum First Nation',
  'Legislative Assembly of British Columbia',
  'Royal British Columbia Museum',
  'Royal BC Museum',
  'BC Pension Corporation',
];

export function defaultRegion(): RegionSettings {
  return {
    places: [...CORE_PLACES, ...LOCAL_PLACES],
    excludePlaces: [...DEFAULT_EXCLUDE_PLACES],
    organizations: [...DEFAULT_ORGANIZATIONS],
  };
}

const CORE_SET = new Set(CORE_PLACES.map((p) => normalize(p)));

const LOCAL_GOVERNMENT =
  /^(?:the )?(?:corporation of (?:the )?)?(?:city|district|town|township|village|municipality|county|resort municipality|regional municipality|rural municipality|regional district) of |(?:^| )regional district(?: |$)|(?:^| )school district(?: |$)|(?:^| )sd ?\d{1,3}(?: |$)/;

const BC_CUE = /(?:^| )(?:british columbia|colombie britannique|bc|b c|vancouver island)(?= |$)/;
const OTHER_PROVINCE =
  /(?:^| )(?:alberta|saskatchewan|manitoba|ontario|quebec|new brunswick|nova scotia|prince edward island|newfoundland|labrador|yukon|northwest territories|nunavut|national capital region)(?= |$)/;

interface CompiledList {
  entries: { phrase: string; normalized: string; re: RegExp }[];
}

const placeCache = new WeakMap<string[], CompiledList>();
const excludeCache = new WeakMap<string[], CompiledList>();

// "Richmond Road", "Vernon Avenue" and "Langley Street" are streets in Greater
// Victoria, not the cities of the same name.
/**
 * Islands reached only by boat: inside the region on the map, but whether the
 * work suits a mainland crew is for a person to judge (D10).
 */
const BOAT_ISLANDS = /(?:^| )(?:sidney|james|piers|portland|coal|knapp|halibut|mandarte|discovery|chatham|trial) islands?(?= |$)/;

const STREET_SUFFIX = '(?! (?:street|st|road|rd|avenue|ave|drive|dr|boulevard|blvd|way|lane|place|pl|crescent|cres|court|ct|highway|hwy)(?: |$))';

function compile(list: string[], opts: { exclude?: boolean } = {}): CompiledList {
  const cache = opts.exclude ? excludeCache : placeCache;
  const cached = cache.get(list);
  if (cached) return cached;
  const entries: CompiledList['entries'] = [];
  for (const phrase of list) {
    const normalized = normalize(phrase);
    if (!normalized) continue;
    const re = opts.exclude
      ? new RegExp(`(?:^| )${escapeRegex(normalized)}${STREET_SUFFIX}(?= |$)`)
      : UNAMBIGUOUS.has(normalized)
        ? phraseRegex(phrase)
        // "Victoria Road" in Nanaimo is not Victoria.
        : new RegExp(`(?:^| )${escapeRegex(normalized)}${STREET_SUFFIX}(?= |$)`);
    if (re) entries.push({ phrase, normalized, re });
  }
  // Longest first, so "Central Saanich" wins over "Saanich".
  entries.sort((a, b) => b.normalized.length - a.normalized.length);
  const compiled = { entries };
  cache.set(list, compiled);
  return compiled;
}

function firstHit(list: CompiledList, text: string, filter?: (normalized: string) => boolean): string | null {
  if (!text) return null;
  for (const entry of list.entries) {
    if (filter && !filter(entry.normalized)) continue;
    if (entry.re.test(text)) return entry.phrase;
  }
  return null;
}

export interface AreaInput {
  title: string;
  organization?: string;
  location?: string;
  description?: string;
  /** The source only lists work for a local buyer (a municipality's own site or portal). */
  localSource?: boolean;
  /** The notice is known to come from British Columbia (e.g. a BC Bid notice). */
  bcSource?: boolean;
}

export interface AreaResult {
  area: 'yes' | 'no' | 'unknown';
  /** The buyer or place that decided it. */
  match: string;
  /** One sentence explaining the call, for the "why" list. */
  note: string;
  /** Stable id of the branch that decided it (rule trace), e.g. `area.local_buyer`. */
  rule?: string;
}

export function assessArea(input: AreaInput, region: RegionSettings): AreaResult {
  const places = compile(region.places);
  const excludes = compile(region.excludePlaces, { exclude: true });
  const orgs = compile(region.organizations);

  const title = normalize(input.title);
  const org = normalize(input.organization);
  const location = normalize(input.location);
  const description = normalize((input.description ?? '').slice(0, 5000));
  // "Vancouver Island" must not trip the "Vancouver" exclusion.
  const forExclude = (text: string) => text.replace(/vancouver island/g, 'vanisle');

  const everything = `${title} ${org} ${location} ${description}`;
  const bc = !!input.bcSource || !!input.localSource || BC_CUE.test(everything);

  const orgHit = firstHit(orgs, org) ?? firstHit(orgs, title);
  const isCore = (n: string) => CORE_SET.has(n);
  const usable = (n: string) => bc || UNAMBIGUOUS.has(n);

  const coreInTitle = firstHit(places, title, (n) => isCore(n) && usable(n));
  const placeInTitle = coreInTitle ?? firstHit(places, title, usable);
  const placeInLocation = firstHit(places, location, usable);
  const placeInOrg = firstHit(places, org, usable);
  const placeInDescription = firstHit(places, description, usable);

  const excludedInTitle = firstHit(excludes, forExclude(title));
  const excludedInLocation = firstHit(excludes, forExclude(location));
  const excludedInOrg = firstHit(excludes, forExclude(org));

  const island = BOAT_ISLANDS.exec(title)?.[0]?.trim();
  if (island) {
    return { area: 'unknown', match: island, note: `The work is on ${island}, which is reached by boat; check whether it suits you.`, rule: 'area.boat_island' };
  }

  if (input.localSource || orgHit) {
    const buyer = orgHit ?? input.organization ?? 'a local buyer';
    if (excludedInTitle && coreInTitle) {
      return { area: 'unknown', match: coreInTitle, note: `The title names both ${coreInTitle} and ${excludedInTitle}; check where the work is.`, rule: 'area.place_and_excluded' };
    }
    if (excludedInTitle) {
      return { area: 'no', match: excludedInTitle, note: `Posted by ${buyer}, but the work is in ${excludedInTitle}, outside your service area.`, rule: 'area.local_buyer_excluded_title' };
    }
    if (excludedInLocation && !placeInLocation && !placeInTitle) {
      return { area: 'no', match: excludedInLocation, note: `Posted by ${buyer}, but the work is in ${excludedInLocation}, outside your service area.`, rule: 'area.local_buyer_excluded_location' };
    }
    return { area: 'yes', match: placeInTitle ?? buyer, note: `${buyer} is a Greater Victoria buyer.`, rule: 'area.local_buyer' };
  }

  const strongPlace = placeInTitle ?? placeInLocation ?? placeInOrg;
  // A council or regional district buys for its own territory, so a non-local
  // one beats a place name that also exists elsewhere.
  if (strongPlace && !UNAMBIGUOUS.has(normalize(strongPlace)) && (excludedInOrg || LOCAL_GOVERNMENT.test(org))) {
    return { area: 'no', match: input.organization ?? '', note: `${input.organization} is not a Greater Victoria buyer.`, rule: 'area.nonlocal_government' };
  }
  if (strongPlace) {
    if (excludedInTitle) {
      return {
        area: 'unknown',
        match: strongPlace,
        note: `Mentions ${strongPlace} but the title names ${excludedInTitle}; check where the work is.`,
        rule: 'area.place_and_excluded',
      };
    }
    return { area: 'yes', match: strongPlace, note: `Work location: ${strongPlace}.`, rule: 'area.place' };
  }

  if (excludedInTitle || excludedInLocation) {
    const where = excludedInTitle ?? excludedInLocation!;
    return { area: 'no', match: where, note: `The work is in ${where}, outside your service area.`, rule: 'area.excluded_place' };
  }
  // A municipality, regional district or school board buys for its own
  // territory. One that is not on the local list is somewhere else.
  if (excludedInOrg || LOCAL_GOVERNMENT.test(org)) {
    return { area: 'no', match: input.organization ?? '', note: `${input.organization} is not a Greater Victoria buyer.`, rule: 'area.nonlocal_government' };
  }

  const otherProvince = OTHER_PROVINCE.test(`${title} ${location}`) && !BC_CUE.test(`${title} ${location}`);
  if (otherProvince && !input.bcSource) {
    return { area: 'no', match: '', note: 'The work is outside British Columbia.', rule: 'area.other_province' };
  }

  if (placeInDescription) {
    // A bare "Victoria" in the description is often just the buyer's head-office address.
    if (normalize(placeInDescription) === 'victoria') {
      return {
        area: 'unknown',
        match: placeInDescription,
        note: 'Victoria is mentioned in the description, but that may be an office address rather than the work site.',
        rule: 'area.description_victoria',
      };
    }
    return { area: 'yes', match: placeInDescription, note: `The description places the work in ${placeInDescription}.`, rule: 'area.description_place' };
  }

  if (bc) {
    return { area: 'unknown', match: '', note: 'A British Columbia notice that does not say where the work is.', rule: 'area.bc_unplaced' };
  }
  return { area: 'no', match: '', note: 'Nothing places this work in Greater Victoria.', rule: 'area.not_local' };
}

/**
 * Cheap pre-filter for national feeds: does this row mention British Columbia
 * or any place in the service area at all?
 */
export function mightBeLocal(text: string, region: RegionSettings): boolean {
  const n = normalize(text.slice(0, 8000));
  if (BC_CUE.test(n)) return true;
  if (firstHit(compile(region.organizations), n)) return true;
  return firstHit(compile(region.places), n, (p) => UNAMBIGUOUS.has(p)) !== null;
}

/**
 * A short stable key for a buyer, used when matching the same notice posted on
 * two different sites: "The Corporation of the District of Saanich" and
 * "District of Saanich" both become "saanich".
 */
// Buyers known by several names. Checked in order: the CRD's housing
// corporation and hospital district are separate buyers and must be tested
// before the plain CRD names.
const ORG_ALIASES: [RegExp, string][] = [
  [/\bcapital region(?:al)? housing\b|\bcrhc\b/, 'crhc'],
  [/\bcapital region(?:al)? hospital\b|\bcrhd\b/, 'crhd'],
  [/\bcapital regional district\b|\bcrd\b/, 'crd'],
  [/\buniversity of victoria\b|\buvic\b/, 'uvic'],
  [/\b(?:sd|school district)\s*(?:no|number)?\s*(6[123])\b/, 'sd$1'],
  [/\bsooke school district\b/, 'sd62'],
  [/\bgreater victoria school district\b/, 'sd61'],
  [/\bsaanich (?:school district|schools)\b/, 'sd63'],
];

export function organizationKey(organization: string): string {
  const raw = normalize(organization);
  for (const [re, key] of ORG_ALIASES) {
    const m = re.exec(raw);
    if (m) return key.replace('$1', m[1] ?? '');
  }
  const n = raw
    .replace(/\b(?:the|corporation|corp|of|city|district|township|town|municipality|village|regional|board|education|school|no|number|and|inc|ltd|society|authority|first nation|nation)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return n.split(' ').slice(0, 3).join('-');
}
