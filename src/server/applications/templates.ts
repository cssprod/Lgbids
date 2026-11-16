import { DateTime } from 'luxon';
import { SERVICE_LABELS, type NoticeType, type Profile, type ServiceKey } from '../../shared/schemas.js';
import type { OpportunityRecord } from '../contracts.js';
import { formatLocal } from '../util/dates.js';
import { collapse, escapeRegex, formatMoney } from '../util/text.js';

/**
 * The words of a submission: the e-mail transmittal and the sections of the
 * submission package.
 *
 * The hard rule here is that every statement about the company comes from a
 * field of the company profile. Purchasing staff read these closely and a
 * single invented claim (years in business, crew size, a certification) can
 * disqualify a bid or cause trouble after award. So when a field is empty the
 * sentence that would have used it is left out, never filled in.
 */

export interface LetterSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  table?: { columns: string[]; rows: string[][] };
}

/** Notice types that ask for qualifications or information, not a price. */
export const NO_PRICE_TYPES: readonly NoticeType[] = ['RFSQ', 'RFEOI', 'RFI'];

/** What the company is sending, as a noun: "Quotation", "Tender"... */
export function submissionWord(type: NoticeType): string {
  switch (type) {
    case 'ITT':
      return 'Tender';
    case 'RFP':
      return 'Proposal';
    case 'RFQ':
      return 'Quotation';
    case 'RFSO':
      return 'Offer';
    case 'RFSQ':
      return 'Qualification submission';
    case 'RFEOI':
      return 'Expression of interest';
    default:
      return 'Submission';
  }
}

/** The name the company is known by: trade name first, as buyers see it on site. */
export function companyName(profile: Profile): string {
  return profile.tradeName || profile.legalName;
}

/** The name that binds the company legally, for signatures and declarations. */
export function legalCompanyName(profile: Profile): string {
  return profile.legalName || profile.tradeName;
}

/**
 * The notice title without a leading copy of the reference number, so
 * "RFQ 26-140 - Boulevard Planting" next to "RFQ 26-140" is not said twice.
 */
export function cleanTitle(opp: Pick<OpportunityRecord, 'title' | 'referenceNumber'>): string {
  const title = collapse(opp.title);
  const ref = collapse(opp.referenceNumber);
  if (!ref) return title;
  const stripped = title.replace(new RegExp(`^${escapeRegex(ref)}\\s*[-–—:|]?\\s*`, 'i'), '').trim();
  return stripped || title;
}

/** "RFQ 26-140 – Boulevard and Median Landscape Maintenance" (reference only when known). */
export function noticeLine(opp: Pick<OpportunityRecord, 'title' | 'referenceNumber'>): string {
  const ref = collapse(opp.referenceNumber);
  const title = cleanTitle(opp);
  return ref ? `${ref} – ${title}` : title;
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function hasPrice(priceTotal: number | null): priceTotal is number {
  return priceTotal !== null && Number.isFinite(priceTotal) && priceTotal > 0;
}

function signer(profile: Profile): { name: string; title: string } {
  if (profile.signatoryName) return { name: profile.signatoryName, title: profile.signatoryTitle };
  return { name: profile.contactName, title: profile.contactTitle };
}

function mailingAddress(profile: Profile): string[] {
  const cityLine = [profile.city, [profile.province, profile.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [profile.addressLine, cityLine].filter(Boolean);
}

/** "Please direct questions ... to Jane Doe, Office Manager, at 250-555-0100 or jane@x.example." */
function contactSentence(profile: Profile): string {
  const ways = [profile.phone, profile.email].filter(Boolean);
  if (!profile.contactName && ways.length === 0) return '';
  const who = profile.contactName ? `${profile.contactName}${profile.contactTitle ? `, ${profile.contactTitle},` : ''}` : 'us';
  const how = ways.length ? ` at ${ways.join(' or ')}` : '';
  return `Please direct any questions about this submission to ${who}${how}.`;
}

// ---------------------------------------------------------------------------
// E-mail transmittal
// ---------------------------------------------------------------------------

export function transmittalText(
  opp: OpportunityRecord,
  profile: Profile,
  opts: { priceTotal: number | null; includeRates: boolean; attachmentNames: string[] },
): string {
  const word = lowerFirst(submissionWord(opp.noticeType));
  const company = legalCompanyName(profile);
  const lines: string[] = [];

  lines.push(`Dear ${opp.contactName ? collapse(opp.contactName) : 'Purchasing'}:`, '');
  lines.push(
    `${company ? `${company} is pleased to submit its` : 'Please find attached our'} ${word} for ${noticeLine(opp)}${opp.organization ? `, issued by ${collapse(opp.organization)}` : ''}.`,
  );
  if (hasPrice(opts.priceTotal)) lines.push('', `Our total price is ${formatMoney(opts.priceTotal)} plus GST.`);
  else if (opts.includeRates) lines.push('', 'Our unit rates are set out in the attached submission package.');

  const names = opts.attachmentNames.filter(Boolean);
  if (names.length) {
    lines.push('', names.length === 1 ? 'Attached:' : 'Attached are:');
    for (const name of names) lines.push(`- ${name}`);
  }

  const contact = contactSentence(profile);
  if (contact) lines.push('', contact);
  lines.push('', 'Please confirm receipt of this submission.');

  const sig = signer(profile);
  const signature = [sig.name, sig.title, company, profile.phone, profile.email].filter(Boolean);
  lines.push('', 'Sincerely,');
  if (signature.length) lines.push('', ...signature);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Submission package
// ---------------------------------------------------------------------------

/**
 * How each kind of work would be handled. These describe the work and the
 * commitments any competent contractor makes when bidding it; they say
 * nothing about the company's history, staff or credentials, which only the
 * profile may supply.
 */
const SERVICE_TEXT: Record<ServiceKey, string> = {
  grounds:
    'We will carry out routine maintenance of the listed sites at the frequencies and standards set out in the specifications, including mowing, edging, bed care, pruning, litter pickup and seasonal clean-ups, and will report any damage or hazards found on site to the buyer’s representative.',
  lawn:
    'Turf work will follow the specified mowing heights and frequencies, with trimming and edging around fixtures, and any aeration, overseeding, top-dressing or fertilizing scheduled to suit the weather and the use of each area. Sports fields will be left in safe, playable condition.',
  garden:
    'Planting beds will be kept weeded, edged, mulched and pruned as specified. New plant material will match the specified species, sizes and quantities, and will be planted and watered in to the specified standard.',
  tree:
    'Tree work will follow accepted arboricultural practice and the buyer’s tree bylaw and permit conditions, with traffic and pedestrian control and site clean-up as the bid documents require.',
  vegetation:
    'Mowing, brushing and invasive plant removal will be carried out within the limits shown, with care around sensitive areas, watercourses and nesting seasons, and removed material will be disposed of as the bid documents direct.',
  install:
    'Installation will follow the drawings and specifications for grading, growing medium, planting, sod and seeding, with materials inspected and approved before placement. Any warranty and establishment period set out in the bid documents will be honoured.',
  hardscape:
    'Walls, paths and paving will be built to the drawings and specifications, with base preparation, compaction and finishing checked at each stage, and the site kept safe and tidy throughout the work.',
  irrigation:
    'Irrigation work will cover start-up, inspection, adjustment, repairs and winterization as specified, with controller schedules set to suit the plantings and any water-use restrictions in effect.',
  restoration:
    'Restoration work will use the specified native species and methods, protect existing native vegetation, limit soil disturbance, and keep invasive material contained and disposed of as directed.',
  snow:
    'Snow and ice control will be carried out to the priorities, response times and service levels set out in the bid documents, with materials applied at the specified rates.',
  supply:
    'Supplied materials will meet the specified species, sizes, grades and quantities, and delivery will be coordinated with the buyer to suit site access and timing.',
  design:
    'Design work will respond to the buyer’s program, site conditions and maintenance capacity, with drawings and specifications prepared to the level of detail the bid documents ask for and reviewed with the buyer at each stage.',
};

const NEUTRAL_APPROACH =
  'We will carry out the work as described in the bid documents and specifications, coordinate schedules and site access with the buyer’s representative, and report any issues or deficiencies promptly.';

export function letterSections(
  opp: OpportunityRecord,
  profile: Profile,
  opts: { priceTotal: number | null; priceNotes: string; includeRates: boolean; zone: string; now: Date },
): LetterSection[] {
  const sections: LetterSection[] = [];
  const word = submissionWord(opp.noticeType);
  const lword = lowerFirst(word);
  const legal = legalCompanyName(profile);
  const services = opp.analysis?.services ?? [];
  const pricing = opp.analysis?.pricing ?? 'unknown';
  const sig = signer(profile);

  // Cover letter ------------------------------------------------------------
  {
    const p: string[] = [];
    p.push(`Dear ${opp.contactName ? collapse(opp.contactName) : 'Purchasing'}:`);
    const operating = profile.legalName && profile.tradeName && profile.tradeName !== profile.legalName ? ` (operating as ${profile.tradeName})` : '';
    const closing = opp.closesAt ? `, closing ${formatLocal(opp.closesAt, opp.closesAtPrecision, opts.zone)}` : '';
    p.push(
      `${legal ? `${legal}${operating} is pleased to submit this` : 'Please accept this'} ${lword} for ${noticeLine(opp)}${opp.organization ? `, issued by ${collapse(opp.organization)}` : ''}${closing}.`,
    );
    if (profile.about) p.push(profile.about);
    if (services.length) {
      const labels = services.map((s) => lowerFirst(SERVICE_LABELS[s]));
      p.push(
        `We understand the work to include ${joinList(labels)}. The pages that follow set out our understanding of the work, how we would carry it out, and the company information the buyer needs to evaluate this ${lword}.`,
      );
    }
    if (hasPrice(opts.priceTotal)) p.push(`Our total price is ${formatMoney(opts.priceTotal)}, plus GST.`);
    const contact = contactSentence(profile);
    if (contact) p.push(contact);
    p.push('Thank you for the opportunity to submit.');
    const signature = [sig.name, sig.title, legal].filter(Boolean);
    p.push(['Sincerely,', '', '', ...signature].join('\n'));
    sections.push({ heading: 'Cover letter', paragraphs: p });
  }

  // Company information -------------------------------------------------------
  {
    const rows: string[][] = [];
    const add = (label: string, value: string | number | null) => {
      if (value === null || value === '') return;
      rows.push([label, String(value)]);
    };
    add('Legal name', profile.legalName);
    if (profile.tradeName && profile.tradeName !== profile.legalName) add('Operating as', profile.tradeName);
    add('Mailing address', mailingAddress(profile).join(', '));
    add('Telephone', profile.phone);
    add('E-mail', profile.email);
    add('Website', profile.website);
    add('Contact', [profile.contactName, profile.contactTitle].filter(Boolean).join(', '));
    add('GST registration number', profile.gstNumber);
    add('WorkSafeBC account number', profile.worksafeNumber);
    add('Business licence', profile.businessLicence);
    add('Year established', profile.yearEstablished);
    add('Crew size', profile.crewSize);
    if (rows.length) sections.push({ heading: 'Company information', paragraphs: [], table: { columns: ['Item', 'Details'], rows } });
  }

  // Understanding of the work ------------------------------------------------
  {
    const p: string[] = [];
    if (services.length) {
      p.push(
        `${opp.organization ? collapse(opp.organization) : 'The buyer'} is seeking ${joinList(services.map((s) => lowerFirst(SERVICE_LABELS[s])))}. Our understanding of each part of the work is set out below; the bid documents and any addenda govern where they differ.`,
      );
      for (const s of services) p.push(`${SERVICE_LABELS[s]}. ${SERVICE_TEXT[s]}`);
    } else {
      p.push('We will carry out the scope of work as described in the bid documents and any addenda.');
    }
    sections.push({ heading: 'Understanding of the work', paragraphs: p });
  }

  // Approach, safety, environment -------------------------------------------
  sections.push({ heading: 'Approach', paragraphs: [profile.approach || NEUTRAL_APPROACH] });
  if (profile.safety) sections.push({ heading: 'Safety', paragraphs: [profile.safety] });
  if (profile.environment) sections.push({ heading: 'Environmental care', paragraphs: [profile.environment] });

  // Team and equipment ---------------------------------------------------------
  {
    const p = [profile.team, profile.equipment].filter(Boolean);
    if (p.length) sections.push({ heading: 'Team and equipment', paragraphs: p });
  }

  // Certifications ----------------------------------------------------------------
  {
    const certs = profile.certifications.map((c) => collapse(c)).filter(Boolean);
    if (certs.length) sections.push({ heading: 'Certifications', paragraphs: [], bullets: certs });
  }

  // Insurance and compliance -----------------------------------------------------
  {
    const b: string[] = [];
    if (profile.insuranceLiability || profile.insuranceProvider) {
      let s = 'Commercial general liability insurance';
      if (profile.insuranceLiability) s += ` with a limit of ${formatMoney(profile.insuranceLiability)}`;
      if (profile.insuranceProvider) s += `, placed with ${profile.insuranceProvider}`;
      if (profile.insurancePolicy) s += ` (policy ${profile.insurancePolicy})`;
      if (profile.insuranceExpiry) s += `, in force until ${formatDay(profile.insuranceExpiry)}`;
      b.push(`${s}.`);
    }
    if (profile.worksafeNumber) b.push(`Registered with WorkSafeBC, account number ${profile.worksafeNumber}.`);
    if (profile.businessLicence) b.push(`Business licence: ${profile.businessLicence}.`);
    if (profile.bondingAvailable) {
      b.push(profile.bondingLimit ? `Bonding is available up to ${formatMoney(profile.bondingLimit)}.` : 'Bonding is available.');
    }
    if (b.length) sections.push({ heading: 'Insurance and compliance', paragraphs: [], bullets: b });
  }

  // References ----------------------------------------------------------------------
  {
    const refs = profile.references.filter((r) => r.client);
    if (refs.length) {
      const cols: { label: string; get: (r: (typeof refs)[number]) => string }[] = [
        { label: 'Client', get: (r) => r.client },
        { label: 'Contact', get: (r) => [r.contactName, r.contactInfo].filter(Boolean).join(', ') },
        { label: 'Work', get: (r) => r.description },
        { label: 'Year', get: (r) => r.year },
        { label: 'Value', get: (r) => r.value },
      ];
      // A column nobody filled in is just noise on the page.
      const used = cols.filter((c, i) => i === 0 || refs.some((r) => c.get(r)));
      sections.push({
        heading: 'References',
        paragraphs: [],
        table: { columns: used.map((c) => c.label), rows: refs.map((r) => used.map((c) => c.get(r))) },
      });
    }
  }

  // Pricing ----------------------------------------------------------------------------
  {
    const p: string[] = [];
    let table: LetterSection['table'];
    if (hasPrice(opts.priceTotal)) p.push(`Total price: ${formatMoney(opts.priceTotal)}, plus GST.`);
    if (opts.priceNotes) p.push(opts.priceNotes);
    const rates = profile.rates.filter((r) => r.label);
    if (opts.includeRates && rates.length) {
      p.push('Our unit rates are set out below. All rates are in Canadian dollars and exclude GST.');
      table = {
        columns: ['Service', 'Unit', 'Rate'],
        rows: rates.map((r) => [r.label, r.unit, formatMoney(r.rate, { cents: true })]),
      };
    }
    const asksForPrice = pricing !== 'none' && !NO_PRICE_TYPES.includes(opp.noticeType);
    if (!hasPrice(opts.priceTotal) && !table && asksForPrice) {
      p.push('Our pricing is provided on the buyer’s pricing form, submitted with this package.');
    }
    if (p.length) sections.push({ heading: 'Pricing', paragraphs: p, ...(table ? { table } : {}) });
  }

  // Declaration --------------------------------------------------------------------------
  {
    const today = DateTime.fromJSDate(opts.now).setZone(opts.zone).toFormat('LLLL d, yyyy');
    sections.push({
      heading: 'Declaration',
      paragraphs: [
        `The undersigned confirms having read the bid documents and any addenda for ${noticeLine(opp)}, that the information in this ${lword} is accurate, and that they are authorized to sign on behalf of ${legal || 'the company'}.`,
        [
          'Signature: ______________________________',
          `Name: ${sig.name || '______________________________'}`,
          `Title: ${sig.title || '______________________________'}`,
          `Company: ${legal || '______________________________'}`,
          `Date: ${today}`,
        ].join('\n'),
      ],
    });
  }

  return sections;
}

/** "2027-03-31" -> "March 31, 2027"; anything unparseable is shown as typed. */
function formatDay(value: string): string {
  const dt = DateTime.fromISO(value);
  return dt.isValid ? dt.toFormat('LLLL d, yyyy') : value;
}

// ---------------------------------------------------------------------------
// File name
// ---------------------------------------------------------------------------

const LEGAL_SUFFIX = /\b(?:ltd|limited|inc|incorporated|corp|corporation|co|llp|ulc)\.?$/i;

function asciiWords(input: string): string[] {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** "Example-Landscaping-RFQ-26-140-submission.pdf": ASCII only, at most 100 characters. */
export function packageFilename(opp: Pick<OpportunityRecord, 'title' | 'referenceNumber'>, profile: Profile): string {
  let company = collapse(companyName(profile)).replace(/[.,\s]+$/, '');
  // Drop "Ltd." and the like: they add length without helping anyone find the file.
  for (let i = 0; i < 2 && LEGAL_SUFFIX.test(company); i++) company = company.replace(LEGAL_SUFFIX, '').replace(/[.,\s]+$/, '');
  const companyPart = asciiWords(company).join('-').slice(0, 40).replace(/-+$/, '');
  const refWords = asciiWords(opp.referenceNumber);
  const noticePart = (refWords.length ? refWords : asciiWords(cleanTitle(opp)).slice(0, 6)).join('-').slice(0, 40).replace(/-+$/, '');
  const stem = [companyPart, noticePart, 'submission'].filter(Boolean).join('-');
  return `${stem.slice(0, 96)}.pdf`;
}
