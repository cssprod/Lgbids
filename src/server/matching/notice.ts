import type { NoticeType } from '../../shared/schemas.js';
import { collapse } from '../util/text.js';

/**
 * Works out what kind of solicitation a notice is, and pulls its reference
 * number out of the title.
 */

interface TypeRule {
  type: NoticeType;
  re: RegExp;
}

// Checked in order; the first rule that matches the title (then the hint,
// then the description) wins. "Request for Qualifications" has to be tested
// before the bare RFQ abbreviation, which nearly always means quotations.
const RULES: TypeRule[] = [
  { type: 'AWARD', re: /\b(?:award(?:ed)? notice|notice of (?:contract )?award|contract award(?:ed)?|award notification|awarded to)\b/i },
  {
    type: 'NOI',
    re: /\b(?:NOI|ACAN|notice of intent|notice of intended|notice of intention|intent to (?:direct(?:ly)? )?(?:award|contract)|direct award|advance contract award|sole[- ]source)\b/i,
  },
  {
    type: 'RFSQ',
    re: /\b(?:RFSQ|RFPQ|RFQu|NRFQ|RFQL)\b|request for (?:supplier |vendor |contractor |pre[- ]?)?qualifications?|pre[- ]?qualif\w+|qualified (?:supplier|contractor|vendor)s? list/i,
  },
  { type: 'RFEOI', re: /\b(?:RFEOI|REOI|RFEI|EOI)\b|expressions? of interest|letter of interest/i },
  { type: 'RFI', re: /\bRFI\b|request for information/i },
  { type: 'RFSO', re: /\b(?:RFSO|RFSA|SOA)\b|standing offers?|supply arrangements?/i },
  { type: 'ITT', re: /\b(?:ITT|ITB|IFB|RFT|NIT)\b|invitation to (?:tender|bid)|(?:request|call) for tenders?|invitation for bids?/i },
  { type: 'RFQ', re: /\b(?:RFQ|ITQ)\b|request for quot(?:e|es|ation|ations)|invitation to quote|call for quot/i },
  { type: 'RFP', re: /\b(?:RFP|NRFP|RFSP)\b|(?:request|call) for proposals?/i },
];

// Looser words used only when nothing above matched.
const FALLBACK: TypeRule[] = [
  { type: 'ITT', re: /\btenders?\b/i },
  { type: 'RFQ', re: /\bquot(?:e|es|ation|ations)\b/i },
  { type: 'RFP', re: /\bproposals?\b/i },
  { type: 'RFSO', re: /\bas[- ](?:and[- ]when[- ])?needed\b|\bon[- ]call\b|\broster\b/i },
];

function firstMatch(rules: TypeRule[], text: string): NoticeType | null {
  let best: { type: NoticeType; index: number } | null = null;
  for (const rule of rules) {
    const m = rule.re.exec(text);
    if (!m) continue;
    // Earliest mention wins, except that "qualifications" beats a bare RFQ.
    if (!best || m.index < best.index) best = { type: rule.type, index: m.index };
  }
  if (best?.type === 'RFQ' && /request for (?:supplier |vendor |contractor |pre[- ]?)?qualifications?|pre[- ]?qualif/i.test(text)) return 'RFSQ';
  return best ? best.type : null;
}

export function detectNoticeType(title: string, description = '', hint = ''): NoticeType {
  return (
    firstMatch(RULES, title) ??
    firstMatch(RULES, hint) ??
    firstMatch(RULES, description.slice(0, 1500)) ??
    firstMatch(FALLBACK, title) ??
    firstMatch(FALLBACK, hint) ??
    'OTHER'
  );
}

const TYPE_WORDS = 'RFP|RFQ|ITT|ITQ|ITB|IFB|RFSO|RFSA|RFSQ|RFPQ|RFEOI|REOI|EOI|RFI|NOI|NRFP|RFT|Tender|Quotation|Contract|Solicitation|Bid|Project|Reference';

// Case-sensitive on purpose: the optional department prefix ("SSI", "ENG",
// "P&R") must be capitals, otherwise "RFP for 2026 landscaping" would yield
// the reference "for 2026".
const TYPE_WORDS_CS =
  'RFP|RFQ|ITT|ITQ|ITB|IFB|RFSO|RFSA|RFSQ|RFPQ|RFEOI|REOI|EOI|RFI|NOI|NRFP|RFT|' +
  '[Tt]ender|TENDER|[Qq]uotation|QUOTATION|[Cc]ontract|CONTRACT|[Ss]olicitation|SOLICITATION|[Bb]id|BID|[Rr]eference|REFERENCE';

// "RFP 26-133", "RFP No. SSI 2026-011", "ITT No. ENG 26-03", "RFP NO P&R 25-02",
// "Tender #2024-15", "RFP No. 2023-WRP-01", "RFQ 2026 069"
const REF_AFTER_TYPE = new RegExp(
  `\\b(?:${TYPE_WORDS_CS})\\b\\.?\\s*(?:N[oO]\\.?|Number|NUMBER|Num\\.?|#)?\\s*[:#]?\\s*` +
    `((?:[A-Z][A-Z&]{0,7}[\\s-]?)?\\d{2,6}(?:[-./](?:\\d[A-Za-z0-9]{0,7}|[A-Z]{1,4}\\b))*(?: \\d{1,6}\\b)?)`,
);
// "ERM2025-017 - RFP - ...", "EPRO2022-018 - ...", "70.26.03-01 RFP - ...", "23-010 Doncaster ..."
const REF_LEADING = /^\s*((?:[A-Z]{2,8}[-\s]?)?\d{2,6}(?:[-./]\d{1,6}){1,3}[A-Z]?)(?![\w])/;
// Federal style: "W0103-24P123/A", "EP922-250123"
const REF_FEDERAL = /\b([A-Z][A-Z0-9]{3,5}-\d{6,}[A-Z0-9]*(?:\/[A-Z])?)(?![\w])/;

/**
 * Pull a solicitation number out of a notice title, e.g. "26-133" from
 * "RFP 26-133 - Restoration Plan, Rithet's Bog". Returns '' when there is none.
 */
export function extractReference(title: string): string {
  const text = collapse(title);
  const m = REF_AFTER_TYPE.exec(text) ?? REF_LEADING.exec(text) ?? REF_FEDERAL.exec(text);
  if (!m) return '';
  let ref = collapse(m[1]!).replace(/[\s.,;:-]+$/, '');
  // A bare year ("RFP 2026 Landscaping") is not a reference number.
  if (/^20\d{2}$/.test(ref)) return '';
  // "2026 069" → "2026-069" so the same number reads the same from every site.
  ref = ref.replace(/(\d) (\d)/g, '$1-$2');
  return ref.toUpperCase();
}

/** Letters and digits only, for comparing references across sites. */
export function referenceKey(reference: string): string {
  const key = reference.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key.length >= 4 ? key : '';
}

const NOISE = new RegExp(
  `\\b(?:${TYPE_WORDS}|request for (?:proposals?|quotations?|quotes?|qualifications?|tenders?|information|standing offers?|expressions? of interest)|invitation to (?:tender|quote|bid)|notice of intent|no|number|the|for|of|and|at|in|to|a)\\b`,
  'gi',
);

/**
 * A simplified title for spotting the same notice on two sites: reference
 * numbers, solicitation-type words and punctuation removed.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // Reference-like tokens: digits with an optional capital-letter prefix ("SSI 2026-011", "ERM2025-017").
    .replace(/\b[A-Z&]{0,8}[\s-]?\d[\w\-./]*/g, ' ')
    .toLowerCase()
    .replace(NOISE, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 1)
    .slice(0, 8)
    .join('-');
}
