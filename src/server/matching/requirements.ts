import type { Profile, Requirement, SubmissionMethod } from '../../shared/schemas.js';
import { findDates, formatLocal, type ParsedDate, type ParseOptions } from '../util/dates.js';
import { collapse, findEmails, formatMoney, isEmail, parseMoney } from '../util/text.js';

/**
 * Reads the plain text of a notice (and any bid documents we could open) and
 * pulls out the things that decide whether and how a bid can go in:
 * how to submit, what must accompany the bid, and how it is priced.
 *
 * Everything here is pattern matching on public text. It is deliberately
 * conservative: when the text is unclear the result says "unknown" rather
 * than guessing, and the application is then held for a person to check.
 */

export type PricingKind = 'rates' | 'lump_sum' | 'none' | 'unknown';

export interface SubmissionInfo {
  method: SubmissionMethod;
  /** Address bids are to be e-mailed to (only when method is "email"). */
  email: string;
  /** Portal address, when one is named. */
  url: string;
  /** The notice says outright that e-mailed bids are refused. */
  emailRefused: boolean;
}

export interface SiteMeeting {
  mandatory: boolean;
  date: ParsedDate | null;
  text: string;
}

export interface NoticeFacts {
  submission: SubmissionInfo;
  /** Address for questions, when one is given separately. */
  contactEmail: string;
  pricing: PricingKind;
  siteMeeting: SiteMeeting | null;
  bidBond: boolean;
  performanceBond: boolean;
  /** Required liability insurance in dollars, when stated. */
  insuranceAmount: number | null;
  insuranceMentioned: boolean;
  worksafe: boolean;
  businessLicence: boolean;
  formsRequired: boolean;
  referencesRequired: number;
  securityClearance: boolean;
  certifications: { key: keyof Profile['credentials']; label: string }[];
  /** Contract length as written, e.g. "three (3) year term". */
  term: string;
}

// ---------------------------------------------------------------------------
// Submission method
// ---------------------------------------------------------------------------

const EMAIL_REFUSED =
  /(?:e-?mail(?:ed)?|electronic|fax(?:ed)?)[^.]{0,70}(?:submissions?|bids?|tenders?|proposals?|quotations?|quotes?|responses?)[^.]{0,40}\bnot\s+(?:be\s+)?(?:accepted|considered|permitted|allowed)|(?:submissions?|bids?|tenders?|proposals?|quotations?|quotes?|responses?)[^.]{0,80}(?:by|via|sent by)\s+(?:e-?mail|fax|facsimile)[^.]{0,50}\bnot\s+(?:be\s+)?(?:accepted|considered|permitted|allowed)/i;

const SUBMIT_CUE =
  /\b(?:submit(?:ted|ting|s)?|submissions?|deliver(?:ed|y)?|send|sent|e-?mailed|forward(?:ed)?|return(?:ed)?|responses?|respond|proposals?|tenders?|bids?|quotations?|quotes?|expressions? of interest)\b/gi;
const INQUIRY_CUE =
  /\b(?:questions?|inquir(?:y|ies)|enquir(?:y|ies)|clarifications?|contact(?:ed|s)?|information|addend(?:a|um)|register(?:ed)?|site (?:meeting|visit|tour)|rsvp|confirm(?:ation)? of attendance|attend(?:ance|ing)?)\b/gi;
const EXPLICIT_EMAIL_SUBMIT =
  /(?:submit(?:ted|ting)?|submissions?|proposals?|tenders?|bids?|quotations?|quotes?|responses?)[^.]{0,120}(?:by|via|through|to)\s+(?:e-?mail|electronic mail)\b|e-?mail(?:ed)?\s+(?:submissions?|proposals?|tenders?|bids?|quotations?|quotes?|responses?)\s+(?:to|are|will|may|must|should)\b|(?:submit(?:ted|ting)?|sent?|deliver(?:ed)?|e-?mailed|forward(?:ed)?)\s+(?:electronically\s+)?(?:in\s+pdf\s+(?:format\s+)?)?(?:by\s+e-?mail\s+)?to:?\s+\S+@/i;

const BONFIRE_CUE = /\bbonfire\b|bonfirehub|euna procurement/i;
const BCBID_SUBMIT =
  /(?:e-?bid\w*|electronic(?:ally)?|online)[^.]{0,80}BC ?Bid|BC ?Bid[^.]{0,80}(?:e-?bid\w*|electronic(?:ally)?\s+submi|online\s+submi)|submi\w+[^.]{0,70}(?:through|via|using|on|to)\s+(?:the\s+)?BC ?Bid/i;
const BIDSTENDERS_CUE = /bids ?(?:&|and) ?tenders|bidsandtenders/i;
const PORTAL_CUE = /\bmerx\b|biddingo|(?:procurement|bidding|vendor|supplier|e-?procurement|e-?bidding|online (?:bidding|submission)) (?:portal|system|platform)/i;
const HARDCOPY_CUE =
  /hard ?cop(?:y|ies)|sealed envelope|(?:delivered|delivery|deliver)\s+(?:by hand|in person)|by hand or (?:by )?courier|physical(?:ly)? deliver|(?:delivered|received) (?:at|to) (?:the )?(?:reception|front (?:counter|desk)|municipal hall|city hall|town hall)/i;

const PORTAL_URL = /https?:\/\/[a-z0-9.-]+\.(?:bonfirehub\.(?:ca|com)|bidsandtenders\.ca|gov\.bc\.ca|merx\.com)[^\s"'<>)\]]*/i;

function lastIndexBefore(re: RegExp, text: string, before: number, window: number): number {
  const start = Math.max(0, before - window);
  const slice = text.slice(start, before);
  let last = -1;
  re.lastIndex = 0;
  for (const m of slice.matchAll(re)) last = start + m.index;
  return last;
}

/** Decide, for each e-mail address in the text, whether bids or questions go to it. */
function classifyEmails(text: string): { submission: string; contact: string } {
  let submission = '';
  let contact = '';
  for (const { email, index } of findEmails(text)) {
    if (!isEmail(email)) continue;
    const submitAt = lastIndexBefore(SUBMIT_CUE, text, index, 220);
    const inquiryAt = lastIndexBefore(INQUIRY_CUE, text, index, 220);
    // The clause the address sits in decides it; the cue nearest the address wins.
    if (submitAt >= 0 && submitAt > inquiryAt) {
      if (!submission) submission = email;
    } else if (!contact) {
      contact = email;
    }
  }
  return { submission, contact };
}

export interface SubmissionHints {
  /** How this source's notices are normally submitted (e.g. a Bonfire portal). */
  sourceDefault?: SubmissionMethod;
  /** Portal or notice address to fall back on. */
  url?: string;
}

export function detectSubmission(text: string, hints: SubmissionHints = {}): { submission: SubmissionInfo; contactEmail: string } {
  const emailRefused = EMAIL_REFUSED.test(text);
  const { submission: submissionEmail, contact } = classifyEmails(text);
  const portalUrl = PORTAL_URL.exec(text)?.[0].replace(/[.,;]+$/, '') ?? '';
  const sourceDefault = hints.sourceDefault ?? 'unknown';
  const portalDefault = sourceDefault === 'bonfire' || sourceDefault === 'bcbid' || sourceDefault === 'bidsandtenders' || sourceDefault === 'portal';

  const info = (method: SubmissionMethod, email = '', url = ''): { submission: SubmissionInfo; contactEmail: string } => ({
    submission: { method, email, url, emailRefused },
    contactEmail: contact || (method === 'email' ? '' : submissionEmail),
  });

  const emailOk = !!submissionEmail && !emailRefused;
  // A notice that lives on a bidding portal is submitted there unless it says
  // in so many words that bids go by e-mail.
  if (emailOk && (!portalDefault || EXPLICIT_EMAIL_SUBMIT.test(text))) return info('email', submissionEmail);
  if (BONFIRE_CUE.test(text) || sourceDefault === 'bonfire') return info('bonfire', '', portalUrl || hints.url || '');
  if (BCBID_SUBMIT.test(text) || sourceDefault === 'bcbid') return info('bcbid', '', portalUrl || hints.url || '');
  if (BIDSTENDERS_CUE.test(text) || sourceDefault === 'bidsandtenders') return info('bidsandtenders', '', portalUrl || hints.url || '');
  if (PORTAL_CUE.test(text) || sourceDefault === 'portal') return info('portal', '', portalUrl || hints.url || '');
  if (HARDCOPY_CUE.test(text) || sourceDefault === 'hardcopy') return info('hardcopy');
  if (sourceDefault === 'email' && emailOk) return info('email', submissionEmail);
  return info('unknown');
}

// ---------------------------------------------------------------------------
// Bid requirements
// ---------------------------------------------------------------------------

const SITE_MEETING =
  /((?:mandatory|compulsory|required|optional|non-?mandatory|voluntary)\s+)?(?:pre-?(?:bid|tender|proposal|submission)\s+)?(?:site\s+(?:meeting|visit|tour|inspection|viewing|walk(?:[- ]?(?:through|about|around))?)|(?:pre-?(?:bid|tender|proposal)|bidders'?|proponents'?|information)\s+(?:meeting|conference|session))([^.]{0,160})/i;
const MANDATORY_NEARBY = /\b(?:mandatory|compulsory|must attend|required to attend|attendance is required|shall attend)\b/i;
const OPTIONAL_NEARBY = /\b(?:optional|non-?mandatory|voluntary|not mandatory|encouraged|recommended|may attend)\b/i;

const MONEY = /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\$\s?\d+(?:\.\d+)?\s*(?:million|mil\b|mm\b|m\b)|\b\d+(?:\.\d+)?\s*million(?:\s+dollars)?/gi;

const CERTIFICATIONS: { key: keyof Profile['credentials']; label: string; re: RegExp }[] = [
  { key: 'isaArborist', label: 'ISA Certified Arborist', re: /\bISA\b[- ]certified|certified arborists?|international society of arboriculture|\bISA\b (?:arborist|certification)/i },
  { key: 'pesticideApplicator', label: 'Pesticide applicator certificate', re: /pesticide applicators?|pesticide (?:licen[cs]e|certificat\w+)|(?:certified|licen[cs]ed) (?:pesticide|herbicide)|\bIPM\b (?:licen[cs]e|certif\w+)/i },
  { key: 'redSeal', label: 'Red Seal / certified horticulturist', re: /red seal|landscape horticulturists?|journey(?:man|person|men)?(?:[- ]level)? (?:horticulturist|gardener|landscaper)|certified (?:landscape )?(?:horticulturist|technician)/i },
  { key: 'corSafety', label: 'COR / SECOR safety certification', re: /\bS?E?COR\b[- ]certif\w+|certificate of recognition|\bSECOR\b|\bCOR\b (?:certification|certificate|program)/i },
  { key: 'firstAid', label: 'Occupational first aid', re: /first aid (?:attendant|certificat\w+|ticket|training)|\bOFA\b (?:level )?[123]|occupational first aid/i },
  { key: 'irrigationCertified', label: 'Certified irrigation technician', re: /\bIIABC\b|certified irrigation (?:technician|contractor|designer|scheduler)|irrigation industry association/i },
];

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function findInsurance(text: string): { amount: number | null; mentioned: boolean } {
  const mentioned = /\b(?:liability|insurance|insured)\b/i.test(text);
  if (!mentioned) return { amount: null, mentioned };
  let best: number | null = null;
  for (const m of text.matchAll(MONEY)) {
    const around = text.slice(Math.max(0, m.index - 110), m.index + m[0].length + 110);
    if (!/\b(?:liability|insurance|insured|CGL)\b/i.test(around)) continue;
    const amount = parseMoney(m[0]);
    // Liability limits are stated in millions; smaller figures are deductibles or fees.
    if (amount && amount >= 1_000_000 && amount <= 100_000_000 && (best === null || amount > best)) best = amount;
  }
  return { amount: best, mentioned };
}

function findSiteMeeting(text: string, opts: ParseOptions): SiteMeeting | null {
  const m = SITE_MEETING.exec(text);
  if (!m) return null;
  const around = text.slice(Math.max(0, m.index - 80), m.index + m[0].length);
  const optional = OPTIONAL_NEARBY.test(around);
  const mandatory = !optional && MANDATORY_NEARBY.test(around);
  const date = findDates(m[0], opts)[0] ?? null;
  return { mandatory, date: date ? { iso: date.iso, precision: date.precision } : null, text: collapse(m[0]).slice(0, 200) };
}

function findPricing(text: string): PricingKind {
  const rates =
    /\b(?:hourly|unit|labou?r|equipment|crew|daily)\s+rates?\b|\bunit prices?\b|\brate (?:schedule|sheet|card)\b|\bschedule of (?:rates|unit prices)\b|\bper[- ](?:hour|visit|cut|acre|hectare|tree|occurrence)\b|\bas[- ](?:and[- ]when[- ])?(?:needed|required|requested)\b|\bon[- ]call\b|\bstanding offers?\b|\bsupply arrangements?\b/i.test(
      text,
    );
  const lump =
    /\blump[- ]sum\b|\bstipulated (?:price|sum)\b|\bfixed[- ]price\b|\btotal (?:tender(?:ed)?|bid|contract|quoted) (?:price|amount|sum)\b|\bcontract price\b|\btender price\b/i.test(text);
  if (rates && !lump) return 'rates';
  if (lump) return 'lump_sum';
  return 'unknown';
}

function findReferences(text: string): number {
  const m =
    /\b(?:minimum of |at least |a minimum of )?(one|two|three|four|five|six|\d)\s*(?:\(\d\)\s*)?(?:(?:client|customer|recent|relevant|similar|project|professional|business|current|different)\s+){0,2}references?\b/i.exec(
      text,
    );
  if (m) {
    const word = m[1]!.toLowerCase();
    return WORD_NUMBERS[word] ?? Number(word);
  }
  return /\b(?:provide|submit|include|list|supply)\b[^.]{0,40}\breferences?\b|\breferences?\b[^.]{0,30}\b(?:required|must be|shall be)\b/i.test(text) ? 1 : 0;
}

export function extractFacts(text: string, opts: ParseOptions & { hints?: SubmissionHints } = {}): NoticeFacts {
  const flat = collapse(text);
  const { submission, contactEmail } = detectSubmission(flat, opts.hints);
  const insurance = findInsurance(flat);
  const term =
    /\b(?:\w+\s*\(\d+\)|\d+|one|two|three|four|five)[- ]\s?(?:year|month)s?\s+(?:term|contract|agreement|period)\b[^.]{0,80}|\bterm of (?:\w+\s*\(\d+\)|\d+|one|two|three|four|five)\s+(?:years?|months?)\b[^.]{0,80}/i.exec(
      flat,
    )?.[0] ?? '';

  return {
    submission,
    contactEmail,
    pricing: findPricing(flat),
    siteMeeting: findSiteMeeting(flat, opts),
    bidBond: /\bbid (?:bonds?|security|deposit)\b|\bconsent of surety\b|\bsurety(?:'s)? consent\b|\bbid bonding\b|\bcertified cheque\b/i.test(flat),
    performanceBond: /\bperformance (?:bonds?|security)\b|\blabou?r (?:and|&) materials? (?:payment )?bonds?\b/i.test(flat),
    insuranceAmount: insurance.amount,
    insuranceMentioned: insurance.mentioned,
    worksafe: /\bworksafe ?bc\b|\bworkers'? compensation\b|\bWCB\b|\bclearance letter\b/i.test(flat),
    businessLicence: /\b(?:business|municipal|inter-?municipal) licen[cs]e\b/i.test(flat),
    formsRequired:
      /\b(?:tender|bid|proposal|quotation|quote|submission|response|price|pricing|offer) forms?\b|\bform of (?:tender|proposal|quotation|offer)\b|\bschedule of (?:prices|quantities)\b|\b(?:appendix|appendices|schedule|attachment)s? [A-Z0-9]{1,3}\b[^.]{0,60}\b(?:must|shall|complete|sign|submit|return)|\bcomplete(?:d)? and sign(?:ed)?\b|\breceipt confirmation form\b|\backnowledg\w+ (?:of )?(?:all )?addend/i.test(
        flat,
      ),
    referencesRequired: findReferences(flat),
    securityClearance: /\bsecurity clearance\b|\breliability status\b|\bsecret clearance\b|\bcriminal record checks?\b/i.test(flat),
    certifications: CERTIFICATIONS.filter((c) => c.re.test(flat)).map(({ key, label }) => ({ key, label })),
    term: collapse(term).slice(0, 140),
  };
}

/** Turn the extracted facts into a checklist measured against the company profile. */
export function buildRequirements(facts: NoticeFacts, profile: Profile, opts: { now?: Date; zone?: string } = {}): Requirement[] {
  const out: Requirement[] = [];
  const now = opts.now ?? new Date();

  if (facts.siteMeeting) {
    const when = facts.siteMeeting.date ? formatLocal(facts.siteMeeting.date.iso, facts.siteMeeting.date.precision, opts.zone) : '';
    const passed = facts.siteMeeting.date ? new Date(facts.siteMeeting.date.iso).getTime() < now.getTime() : false;
    out.push({
      key: 'site_meeting',
      label: facts.siteMeeting.mandatory ? 'Mandatory site meeting' : 'Site meeting (check whether attendance is required)',
      detail: when ? `${when}${passed ? ' — already held' : ''}` : 'Date not found in the notice',
      met: facts.siteMeeting.mandatory ? (passed ? false : null) : null,
    });
  }
  if (facts.bidBond) {
    out.push({ key: 'bid_bond', label: 'Bid bond or bid security', detail: '', met: profile.bondingAvailable ? null : false });
  }
  if (facts.performanceBond) {
    out.push({ key: 'performance_bond', label: 'Performance bond if awarded', detail: '', met: profile.bondingAvailable ? null : false });
  }
  if (facts.insuranceMentioned) {
    const have = profile.insuranceLiability;
    const need = facts.insuranceAmount;
    out.push({
      key: 'insurance',
      label: 'Liability insurance',
      detail: need ? `${formatMoney(need)} required${have ? `, you carry ${formatMoney(have)}` : ''}` : 'Amount not stated in the notice',
      met: have ? (need ? have >= need : true) : null,
    });
  }
  if (facts.worksafe) {
    out.push({ key: 'worksafe', label: 'WorkSafeBC coverage in good standing', detail: '', met: profile.worksafeNumber ? true : null });
  }
  if (facts.businessLicence) {
    out.push({ key: 'business_licence', label: 'Business licence', detail: '', met: profile.businessLicence ? true : null });
  }
  for (const cert of facts.certifications) {
    out.push({ key: 'certification', label: cert.label, detail: '', met: profile.credentials[cert.key] ? true : false });
  }
  if (facts.referencesRequired > 0) {
    const have = profile.references.filter((r) => r.client).length;
    out.push({
      key: 'references',
      label: facts.referencesRequired > 1 ? `${facts.referencesRequired} references` : 'References',
      detail: `${have} on file`,
      met: have >= facts.referencesRequired,
    });
  }
  if (facts.securityClearance) {
    out.push({ key: 'security_clearance', label: 'Security clearance or record checks', detail: '', met: null });
  }
  if (facts.formsRequired) {
    out.push({
      key: 'forms',
      label: "Buyer's own forms must be completed",
      detail: 'Download them from the bid documents, fill them in and attach them.',
      met: null,
    });
  }
  return out;
}
