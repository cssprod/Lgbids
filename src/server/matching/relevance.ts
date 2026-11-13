import type { ServiceKey } from '../../shared/schemas.js';
import { SERVICE_KEYS } from '../../shared/schemas.js';
import { normalize, phraseRegex, uniq } from '../util/text.js';

/**
 * Decides whether a notice is gardening / landscaping work, and which kind.
 *
 * Text is normalised first (lower case, punctuation to spaces), phrases that
 * only look relevant are blanked out ("treatment plant", "threat landscape",
 * "parking"), and what is left is matched against a weighted vocabulary.
 * A term in the title counts for much more than the same term buried in the
 * description.
 */

type Strength = 1 | 2 | 3;

interface Term {
  label: string;
  service: ServiceKey;
  strength: Strength;
  re: RegExp;
}

const terms: Term[] = [];
function add(service: ServiceKey, strength: Strength, label: string, pattern: string): void {
  terms.push({ label, service, strength, re: new RegExp(`\\b(?:${pattern})\\b`, 'g') });
}

// --- Grounds & general landscape maintenance --------------------------------
add('grounds', 3, 'landscape maintenance', 'landscap(?:e|ing) (?:maintenance|services?|contractors?|management|upkeep)');
add('grounds', 3, 'landscaping', 'landscaping|landscapers?');
add('grounds', 3, 'grounds maintenance', 'grounds ?keep(?:ing|ers?)|grounds? (?:maintenance|care|services?|upkeep)');
add('grounds', 3, 'yard maintenance', 'yard (?:maintenance|care|work|clean ?ups?|services?)');
add('grounds', 3, 'boulevard maintenance', '(?:boulevards?|medians?|roundabouts?) (?:maintenance|mowing|landscap\\w*|planting|trees?)');
add('grounds', 3, 'parks maintenance', 'parks? (?:maintenance|grounds|horticultur\\w*)');
add('grounds', 3, 'cemetery grounds', 'cemeter(?:y|ies) (?:grounds|maintenance|landscap\\w*|mowing)');
add('grounds', 2, 'leaf collection', 'leaf (?:collection|removal|pick ?up|clean ?up|blowing)|(?:fall|spring) clean ?ups?');
add('grounds', 1, 'landscape', 'landscapes?');
add('grounds', 1, 'grounds', 'grounds');
add('grounds', 1, 'exterior maintenance', '(?:outdoor|exterior|property|site) maintenance');

// --- Lawn & turf ------------------------------------------------------------
add('lawn', 3, 'lawn care', 'lawns?');
add('lawn', 3, 'mowing', 'mow(?:ing|ed)?');
add('lawn', 3, 'grass cutting', 'grass (?:cutting|mowing|trimming|maintenance|seeding|cut)');
add('lawn', 3, 'turf', 'turf(?: ?grass)?');
add('lawn', 3, 'sod', 'sod(?:ding)?');
add('lawn', 3, 'top dressing', 'top ?dress(?:ing)?|over ?seed(?:ing)?');
add(
  'lawn',
  3,
  'sports field maintenance',
  '(?:sports?|ball|baseball|soccer|softball|playing|athletic|rugby|cricket) ?(?:fields?|diamonds?|pitch(?:es)?) (?:maintenance|renovations?|grooming|mowing|turf|aeration|top ?dressing|lining|upgrades?)',
);
add('lawn', 2, 'aeration', 'aerat(?:ion|ing|e)');
add('lawn', 2, 'sports fields', '(?:sports?|athletic|playing) ?fields?|ball diamonds?|bowling greens?');
add('lawn', 2, 'fertilizing', 'fertili[sz](?:ing|ation)');

// --- Gardens, planting & horticulture ----------------------------------------
add('garden', 3, 'gardening', 'gardening|gardeners?');
add('garden', 3, 'garden maintenance', 'gardens? (?:maintenance|services?|care|beds?|planting|installation|construction|renovations?)');
add('garden', 3, 'planting beds', '(?:flower|planting|shrub|perennial|annual|landscape|plant|garden) beds?|bed maintenance');
add('garden', 3, 'horticulture', 'horticultur(?:e|al|ist|ists)');
add('garden', 3, 'hanging baskets', 'hanging (?:flower )?baskets?|flower baskets?|floral (?:displays?|plantings?)|bedding plants?');
add('garden', 3, 'weeding', 'weeding');
add('garden', 3, 'mulching', 'mulch(?:ing|es)?');
add('garden', 3, 'pruning', 'prun(?:ing|e|ed)');
add('garden', 3, 'hedge trimming', 'hedges? (?:trimming|cutting|maintenance|pruning|shearing)');
add('garden', 3, 'shrubs', 'shrubs?|ornamental (?:plants?|trees?|grass\\w*|horticulture)');
add('garden', 3, 'interior plants', '(?:interior|indoor|tropical|office) plants?|plantscap\\w*|plant (?:care|watering|rental)');
add('garden', 2, 'gardens', 'gardens?');
add('garden', 2, 'planting', 'plantings?');
add('garden', 2, 'hedges', 'hedges?|perennials?|annuals');
add('garden', 1, 'plants', 'plants?|flowers?|weeds?|nursery|greenhouses?');

// --- Trees ------------------------------------------------------------------
add('tree', 3, 'arborist services', 'arborists?|arbori ?cultur\\w*');
add(
  'tree',
  3,
  'tree services',
  'trees? (?:services?|care|work|pruning|trimming|removals?|felling|falling|planting|maintenance|watering|risk|protection|replacement|cutting|topping|limbing|crew|supply|installation)',
);
add('tree', 3, 'hazard trees', '(?:hazard|hazardous|danger|dangerous) trees?|stump (?:grinding|removal)');
add('tree', 3, 'street trees', 'street trees?|urban forest(?:ry)?|trees? and shrubs?');
add('tree', 2, 'chipping', '(?:wood|brush) chipp(?:ing|er)');
add('tree', 1, 'trees', 'trees?|forestry');

// --- Vegetation management ----------------------------------------------------
add('vegetation', 3, 'vegetation management', 'vegetation (?:management|control|maintenance|removal|clearing|services?|cutting)');
add('vegetation', 3, 'brushing', 'brushing|brush (?:cutting|clearing|removal|control|mowing)');
add('vegetation', 3, 'flail / roadside mowing', 'flail|(?:roadside|rough|boom|slope|highway|ditch|shoulder|right of way) (?:mowing|vegetation|brushing)');
add('vegetation', 3, 'invasive plant removal', 'invasive (?:species|plants?|weeds?|vegetation)|noxious weeds?');
add(
  'vegetation',
  3,
  'invasive plant removal',
  'knotweed|hogweed|scotch broom|english ivy|himalayan blackberry|gorse|spurge laurel|(?:broom|ivy|blackberry) removal',
);
add('vegetation', 3, 'weed control', 'weed (?:control|management|removal|abatement|spraying)');
add('vegetation', 2, 'vegetation', 'vegetation|herbicides?|pesticide application|integrated pest management');
add('vegetation', 2, 'fuel management', 'fuel (?:management|mitigation|treatments?|reduction)|firesmart|wildfire fuel');
add('vegetation', 2, 'land clearing', '(?:land|site) clearing|clearing and grubbing|grubbing');

// --- Landscape construction ---------------------------------------------------
add(
  'install',
  3,
  'landscape construction',
  'landscap(?:e|ing) (?:construction|installation|improvements?|upgrades?|renovations?|works?|rehabilitation|enhancements?|replacement|redevelopment|restoration)',
);
add('install', 3, 'soft landscaping', 'soft ?scap(?:e|es|ing)|soft landscap\\w*');
add(
  'install',
  3,
  'supply and install',
  'supply (?:deliver(?:y)? )?and install\\w* (?:of )?(?:\\w+ ){0,3}(?:plants?|trees?|shrubs?|sod|turf|landscap\\w*|planting|topsoil|mulch)',
);
add('install', 3, 'hydroseeding', 'hydro ?seed(?:ing)?');
add('install', 3, 'rain gardens', 'rain gardens?|bio ?swales?');
add('install', 3, 'planting works', 'planting (?:installation|services?|program|projects?|works?)|tree planting');
add('install', 2, 'park improvements', 'parks? (?:development|construction|improvements?|upgrades?|redevelopment|renewal|expansion|renovations?)');
add('install', 2, 'streetscape', 'streetscap\\w*|green roofs?|living walls?|green walls?');
add('install', 2, 'trail construction', 'trails? (?:construction|building|maintenance|upgrades?|improvements?|restoration)');
add('install', 2, 'seeding', 'seeding|erosion control|(?:slope|bank) stabili[sz]ation|site (?:restoration|reinstatement)');
add('install', 1, 'parks', 'parks?|playgrounds?|trails?|green ?spaces?|open spaces?|soil');

// --- Hardscape ----------------------------------------------------------------
add('hardscape', 3, 'hardscape', 'hard ?scap(?:e|es|ing)|hard landscap\\w*');
add('hardscape', 2, 'retaining / rock walls', '(?:retaining|rock|stone|garden|boulder) walls?|dry ?stack\\w*');
add('hardscape', 2, 'pavers', 'pavers|paving stones?|interlock(?:ing)?|unit pav\\w*|flagstone|stone ?work|stone steps');
add('hardscape', 2, 'gravel paths', '(?:gravel|crushed stone) (?:paths?|trails?|walkways?)|patios?');
add('hardscape', 1, 'pathways', 'pathways?|walkways?|fenc(?:e|es|ing)');

// --- Irrigation ---------------------------------------------------------------
add('irrigation', 3, 'irrigation', 'irrigation');
add('irrigation', 3, 'lawn sprinklers', '(?:lawn|landscape|turf|field|garden|underground|in ground) sprinklers?');
add('irrigation', 1, 'sprinklers', 'sprinklers?|backflow');

// --- Ecological restoration ---------------------------------------------------
add(
  'restoration',
  3,
  'ecological restoration',
  '(?:ecological|habitat|riparian|wetland|meadow|garry oak|ecosystem|stream|streamside|creek|shoreline|foreshore|dune|natural areas?|native) (?:restoration|enhancement|planting|rehabilitation|revegetation)',
);
add('restoration', 3, 'native planting', 're ?vegetation|native (?:plants?|plantings?|species planting|vegetation)|restoration plant(?:ing|s)');
add('restoration', 3, 'bioengineering', 'live stak(?:ing|es)|bio ?engineering|reforestation');
add('restoration', 2, 'restoration project', 'restoration (?:plan|projects?|works?|services|program)');
add('restoration', 2, 'natural areas', 'natural areas? (?:management|maintenance|stewardship)|stewardship|garry oak|riparian');
add('restoration', 1, 'restoration', 'restoration|habitat|ecological|wetlands?');

// --- Snow & ice ---------------------------------------------------------------
add('snow', 3, 'snow removal', 'snow (?:removal|clearing|plowing|ploughing|and ice|management|services?|control|shovell?ing|hauling)');
add('snow', 3, 'ice control', 'ice (?:control|management)|de ?icing|salting (?:and|services)|sanding (?:and salting|services)');
add('snow', 2, 'winter maintenance', 'winter maintenance');

// --- Supply only ---------------------------------------------------------------
add(
  'supply',
  3,
  'supply of plant material',
  '(?:supply|purchase|provision|delivery) (?:and delivery |and supply )?of (?:\\w+ ){0,3}(?:plants?|trees?|shrubs?|nursery stock|sod|turf|seeds?|mulch|topsoil|soils?|growing medium|fertili[sz]ers?|bark|compost|bulbs?|annuals|perennials|flowers|planters?)',
);
add('supply', 3, 'nursery stock', 'nursery (?:stock|plants?|trees?|supply|materials?)|plant (?:materials?|supply|stock)');
add('supply', 3, 'seed', '(?:grass|turf|wildflower|lawn) seeds?|seed mix(?:es)?|bark mulch');
add(
  'supply',
  3,
  'grounds equipment',
  '(?:lawn|garden|landscape|landscaping|grounds|turf|parks) (?:equipment|supplies|tools|tractors?|machinery)|(?:ride on|riding|zero turn|rotary|reel|wide area|robotic|lawn) ?mowers?|(?:lawn|garden|compact|utility) tractors?',
);
add('supply', 2, 'equipment', 'mowers?|(?:leaf|backpack) blowers?|string trimmers?|chain ?saws?|wood chippers?|stump grinders?');
add('supply', 2, 'soil and growing medium', 'top ?soil|growing medium|garden soil|soil amendments?|fertili[sz]ers?');

// --- Design & consulting --------------------------------------------------------
add('design', 3, 'landscape architecture', 'landscape architect\\w*');
add('design', 3, 'landscape design', 'landscape (?:design|plan|planning|master plan|concept|strategy|guidelines|standards)|planting (?:design|plan)');
add(
  'design',
  3,
  'parks planning',
  '(?:parks?|parks? and trails?|parks and recreation|parks recreation and culture|open space|trails?|urban forest|tree|greenways?|playground) (?:master ?plan|strategy|management plan|strategic plan|needs assessment|plan update)',
);
add('design', 3, 'tree assessment', 'arborist reports?|tree (?:inventory|risk assessments?|canopy (?:study|assessment))|urban forest (?:strategy|plan|management)');
add(
  'design',
  3,
  'restoration planning',
  '(?:restoration|vegetation|invasive species|natural areas?|stewardship|ecological) (?:management )?(?:plan|strategy|study|assessment)',
);
add('design', 3, 'horticultural consulting', 'horticultural consult\\w*|irrigation (?:design|audit|assessment)');
add('design', 2, 'master plan', 'master ?plan|(?:park|parks|trail|playground|streetscape|plaza|waterfront) (?:design|planning|concept)');

/**
 * Phrases that contain a vocabulary word but have nothing to do with
 * landscaping. They are blanked out before matching.
 */
const MASKS: RegExp[] = [
  /\b(?:water|wastewater|waste water|sewage|sewer|treatment|power|heating|cooling|central|asphalt|batch|concrete|processing|manufacturing|recycling|composting|desalination|cogeneration|chiller|boiler|steam|physical|pilot|mechanical|electrical|hvac) plants?\b/g,
  /\bplants? (?:upgrades?|operations?|operators?|expansion|equipment|shutdown|managers?|engineer\w*|commissioning|optimi[sz]ation|capacity|process\w*|room)\b/g,
  /\bplant and equipment\b|\bproperty plant\b|\bwwtp\b|\bwtp\b/g,
  /\bpump(?:ing)? stations?\b/g,
  /\b(?:threat|policy|funding|competitive|regulatory|political|media|technology|digital|vendor|market|legal|legislative|economic|research|data|risk|security|cyber\w*|it|business|service|program|current|changing|evolving|broader|health ?care|housing|energy|financial|industry|learning|educational|employment|labou?r|cultural) landscapes?\b/g,
  /\blandscapes? (?:of|scan|review|analysis|study|report|survey|mode|orientation|format|photograph\w*|painting|scale|ecology|connectivity|unit|fire|level)\b/g,
  /\b(?:decision|family|phone|fault|christmas) trees?\b|\btrees? (?:structure|view|diagram|menu)\b/g,
  /\bkindergarten\w*\b|\bbeer gardens?\b|\bgardens? (?:suites?|city|homes?|apartments?|level|centre|center|court|village|towers?|inn)\b/g,
  /\bparking\b|\bparkades?\b|\bpark and rides?\b|\b(?:car|business|industrial|technology|research|trailer|mobile home|science|office) parks?\b/g,
  /\bseed (?:funding|money|grants?|capital|investment|round)\b/g,
  /\bhedge funds?\b|\bhedging (?:strategy|program|policy|instruments?)\b|\b(?:fuel|currency|commodity|interest rate|price) hedg\w+\b/g,
  /\bgreenhouse gas(?:es)?\b|\bghg\b/g,
  /\b(?:wound|bladder|nasal|ear|eye|surgical|colonic|sinus|oral|dental|medical) irrigation\b|\birrigation (?:solutions?|fluids?|syringes?|sets?|tubing|districts?)\b/g,
  /\bfire sprinklers?\b|\b(?:building|wet|dry|pre ?action) sprinklers?\b|\bsprinkler (?:heads?|systems?) (?:inspection|testing|retrofit|replacement)\b/g,
  /\baeration (?:basins?|tanks?|blowers?|systems?|diffusers?|equipment|upgrades?|cells?|lagoons?|piping)\b/g,
  /\b(?:building|heritage|masonry|fire|flood|water damage|concrete|window|roof|pavement|asphalt|road|structural|facade|envelope|bridge|data|system|service|power|disaster) restoration\b/g,
  /\bartificial turf\b|\bsynthetic turf\b|\bturf wars?\b/g,
  /\bgrass ?roots\b|\broot cause\b|\byard waste\b|\b(?:works|public works|storage|rail|ship|lumber|scrap|operations) yards?\b/g,
  /\bgreen (?:fleet|energy|building|bins?|waste)\b|\btree of life\b|\bfield (?:services?|work|office|staff|testing|data|trips?|house|technicians?|inspections?|engineer\w*|review)\b/g,
];

const CODE_RE = /\b(?:7011(?:15|16|17)\d{2}|72102902|s208)\b/i;

const STRENGTH_WORD: Record<Strength, string> = { 3: 'strong', 2: 'medium', 1: 'weak' };
const TITLE_POINTS: Record<Strength, number> = { 3: 75, 2: 50, 1: 15 };
const BODY_POINTS: Record<Strength, number> = { 3: 45, 2: 25, 1: 8 };
const EXTRA_POINTS: Record<Strength, number> = { 3: 8, 2: 4, 1: 1 };
const SERVICE_WEIGHT_TITLE: Record<Strength, number> = { 3: 3, 2: 2, 1: 0.5 };
const SERVICE_WEIGHT_BODY: Record<Strength, number> = { 3: 1.5, 2: 0.75, 1: 0.1 };

export interface TermMatch {
  label: string;
  service: ServiceKey;
  strength: Strength;
  where: 'title' | 'body';
}

export interface RelevanceResult {
  /** 0–100. 45 and up is treated as landscaping work; 25–44 is borderline. */
  score: number;
  matches: TermMatch[];
  /** Human-readable matched terms, strongest first. */
  matchedTerms: string[];
  /** Kinds of work detected, most prominent first. */
  services: ServiceKey[];
  primary: ServiceKey | null;
  /** The notice buys goods (plants, soil, equipment) rather than work. */
  supplyOnly: boolean;
  /** The notice buys a plan, study or design rather than physical work. */
  consulting: boolean;
  codeMatch: boolean;
  /** The title itself names landscaping work (not just the description). */
  inTitle: boolean;
}

export const RELEVANT_AT = 45;
export const BORDERLINE_AT = 25;

function mask(text: string): string {
  let out = text;
  for (const re of MASKS) out = out.replace(re, ' ');
  return out;
}

function collect(text: string, where: 'title' | 'body'): TermMatch[] {
  const out: TermMatch[] = [];
  if (!text) return out;
  for (const term of terms) {
    term.re.lastIndex = 0;
    if (term.re.test(text)) out.push({ label: term.label, service: term.service, strength: term.strength, where });
  }
  return out;
}

const ROUGH_MOWING = /\b(?:flail|roadside|rough cut|boom|slope|highway|ditch|shoulder|right of way)\b/;
const SUPPLY_TITLE = /\b(?:supply|purchase|procurement|provision|delivery|acquisition)\b/;
const WORK_TITLE = /\b(?:install\w*|planting|maintenance|services?|construction|placement|removal|renovation|restoration|mowing|pruning|cutting)\b/;
const CONSULT_TITLE = /\b(?:plan|plans|planning|study|studies|strategy|design|consult\w*|assessment|inventory|architect\w*|review|audit|feasibility|report)\b/;

export interface RelevanceInput {
  title: string;
  description?: string;
  categories?: string[];
}

export function assessRelevance(input: RelevanceInput, opts: { includeKeywords?: string[] } = {}): RelevanceResult {
  const titleN = normalize(input.title);
  const rawBody = [input.description ?? '', ...(input.categories ?? [])].join(' \n ');
  const bodyN = normalize(rawBody.slice(0, 20000));
  const title = mask(titleN);
  const body = mask(bodyN);

  const titleMatches = collect(title, 'title');
  const bodyMatches = collect(body, 'body');

  const titleBest = Math.max(0, ...titleMatches.map((m) => TITLE_POINTS[m.strength]));
  const bodyBest = Math.max(0, ...bodyMatches.map((m) => BODY_POINTS[m.strength]));
  let score = Math.max(titleBest, bodyBest);

  // Title and description agreeing is worth more than either alone.
  const titleSolid = titleMatches.some((m) => m.strength >= 2);
  const bodySolid = bodyMatches.some((m) => m.strength >= 2);
  if (titleSolid && bodySolid) score += 10;

  // Each further distinct term adds a little, up to a cap.
  const seen = new Map<string, Strength>();
  for (const m of [...titleMatches, ...bodyMatches]) {
    const prev = seen.get(m.label);
    if (!prev || m.strength > prev) seen.set(m.label, m.strength);
  }
  const extras = [...seen.values()].sort((a, b) => b - a).slice(1);
  score += Math.min(25, extras.reduce((sum, s) => sum + EXTRA_POINTS[s], 0));

  const codeMatch = CODE_RE.test([...(input.categories ?? [])].join(' '));
  if (codeMatch) score = Math.max(60, score + 35);

  const includeHit = (opts.includeKeywords ?? []).find((k) => {
    const re = phraseRegex(k);
    return re ? re.test(titleN) || re.test(bodyN) : false;
  });
  if (includeHit) score = Math.max(70, score);

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Which kinds of work, weighted by where and how strongly each was mentioned.
  const weights = new Map<ServiceKey, number>();
  // "Roadside flail mowing" is vegetation control, not lawn care.
  const roughMowing = ROUGH_MOWING.test(title);
  const serviceOf = (m: TermMatch): ServiceKey => (roughMowing && m.label === 'mowing' ? 'vegetation' : m.service);
  for (const m of titleMatches) weights.set(serviceOf(m), (weights.get(serviceOf(m)) ?? 0) + SERVICE_WEIGHT_TITLE[m.strength]);
  for (const m of bodyMatches) weights.set(serviceOf(m), (weights.get(serviceOf(m)) ?? 0) + SERVICE_WEIGHT_BODY[m.strength]);

  const hasSupplyWord = SUPPLY_TITLE.test(title);
  const hasWorkWord = WORK_TITLE.test(title);
  const supplyOnly = (weights.get('supply') ?? 0) >= 2 && hasSupplyWord && !hasWorkWord;
  const consulting = (weights.get('design') ?? 0) >= 2 && CONSULT_TITLE.test(title);

  let services = SERVICE_KEYS.filter((k) => (weights.get(k) ?? 0) >= 1).sort(
    (a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0),
  );
  if (supplyOnly) services = ['supply'];
  else if (consulting) services = ['design', ...services.filter((s) => s !== 'design')];
  const primary = services[0] ?? null;

  const ordered = [...titleMatches, ...bodyMatches].sort(
    (a, b) => b.strength - a.strength || (a.where === b.where ? 0 : a.where === 'title' ? -1 : 1),
  );
  const matchedTerms = uniq(ordered.filter((m) => m.strength >= 2 || ordered.length <= 3).map((m) => m.label)).slice(0, 8);
  if (includeHit) matchedTerms.unshift(`your keyword “${includeHit}”`);

  return { score, matches: ordered, matchedTerms, services, primary, supplyOnly, consulting, codeMatch, inTitle: titleSolid || !!includeHit || codeMatch };
}

/** Cheap pre-filter for large national feeds: could this row possibly be relevant? */
export function mightBeRelevant(text: string): boolean {
  const n = mask(normalize(text.slice(0, 6000)));
  for (const term of terms) {
    if (term.strength < 2) continue;
    term.re.lastIndex = 0;
    if (term.re.test(n)) return true;
  }
  return CODE_RE.test(text);
}

export function describeStrength(strength: Strength): string {
  return STRENGTH_WORD[strength];
}

/** Search phrases used when a source can only be queried by keyword. */
export const DEFAULT_SEARCH_QUERIES = [
  'landscaping',
  'landscape maintenance',
  'grounds maintenance',
  'mowing',
  'tree',
  'arborist',
  'garden',
  'horticulture',
  'turf',
  'irrigation',
  'vegetation',
  'invasive species',
  'planting',
  'restoration',
];
