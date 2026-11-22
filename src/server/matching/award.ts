// Reading who won a bid from an award or result notice (MAT-16). Pure: no I/O.
// What it finds is only ever a suggestion; the user confirms it (UX-11).
import { DateTime } from 'luxon';
import { parseDate } from '../util/dates.js';
import { collapse, normalize, parseMoney } from '../util/text.js';

export interface ExtractedAward {
  /** The company named as the winner, or '' when none was found. */
  winner: string;
  amount: number | null;
  /** The amount exactly as written, e.g. "$48,500.00 (excluding GST)". */
  amountText: string;
  /** The award date as YYYY-MM-DD, when stated. */
  awardedOn: string | null;
  /** The sentence the winner (or amount) was read from. */
  excerpt: string;
}

// A company name: capitalised words, with the usual small joining words and
// company endings ("Ltd.", "Inc."). It stops at the first ordinary lower-case word.
const NAME = String.raw`((?:[A-Z0-9][\w&'’.\-]*)(?:\s+(?:[A-Z0-9(][\w&'’.()\-]*|&|and|of|the|de|du))*)`;

const WINNER_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:was|were|has been|have been|is|been)?\s*awarded\s+to\s*[:\-–]?\s*(?:the\s+firm\s+)?${NAME}`),
  new RegExp(String.raw`\bawarded\s+(?:the|this|a)\s+(?:contract|work|tender|bid|agreement)\s+to\s+${NAME}`),
  new RegExp(String.raw`\bsuccessful\s+(?:proponent|bidder|proposer|respondent|vendor|contractor|tenderer)s?\s*(?:is|was|:|-|–)?\s*(?:is\s+)?${NAME}`, 'i'),
  new RegExp(String.raw`\b(?:awarded\s+to|award(?:ee)?|vendor|contractor|supplier|winner)\s*:\s*${NAME}`, 'i'),
];

// Endings that keep their full stop ("Ltd." is part of the name, not the end of a sentence).
const KEEP_DOT = /\b(?:ltd|inc|corp|co|ltée|ltee|llc|llp)\.$/i;
// Words a name never ends with; they belong to the sentence around it.
const TRAILING = /\s+(?:and|of|the|de|du|&)$/i;
const NOT_A_NAME = /^(?:the|a|an|this|that|our|its|their|it|in|on|for|by)$/i;

function cleanName(raw: string): string {
  let name = collapse(raw).replace(/[,;:]+$/, '');
  while (TRAILING.test(name)) name = name.replace(TRAILING, '');
  if (name.endsWith('.') && !KEEP_DOT.test(name)) name = name.slice(0, -1);
  name = name.replace(/\s*\($/, '').trim();
  if (!name || NOT_A_NAME.test(name) || !/[A-Za-z]/.test(name)) return '';
  return name.slice(0, 200);
}

const MONEY = /\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?:\s*(?:million|thousand|k|m)\b)?(?:\s*\((?:plus|excluding|including|incl\.?|excl\.?|\+)\s*(?:applicable\s+)?(?:GST|PST|taxes|tax)[^)]*\))?/i;

const AWARD_DATE = /\b(?:awarded\s+on|award(?:ed)?\s+date|date\s+(?:of\s+)?award(?:ed)?|date\s+awarded)\s*[:\-–]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/i;

/** Split into sentences without breaking "Ltd." or "$1.5". */
function sentences(text: string): string[] {
  return text
    .split(/(?<!\b(?:Ltd|Inc|Corp|Co|No|St|Ltée))(?<=[.!?])\s+(?=[A-Z(])|\n+/)
    .map((s) => collapse(s))
    .filter(Boolean);
}

function isoDay(raw: string, zone: string): string | null {
  const parsed = parseDate(raw, { zone });
  // A date-only value is stored as the end of that local day, so read the day in the zone, not in UTC.
  return parsed ? DateTime.fromISO(parsed.iso, { zone: 'utc' }).setZone(zone).toISODate() : null;
}

/**
 * Read the winner, amount and date from an award notice ("awarded to X",
 * "successful proponent", "$"). Returns null when the text names neither a
 * winner nor an amount. Dates are read in `zone`; a date-only award date is a calendar day.
 */
export function extractAward(text: string, opts: { zone?: string } = {}): ExtractedAward | null {
  const zone = opts.zone ?? 'America/Vancouver';
  const all = sentences(text ?? '');
  let winner = '';
  let excerpt = '';
  for (const sentence of all) {
    for (const re of WINNER_PATTERNS) {
      const m = re.exec(sentence);
      const name = m ? cleanName(m[1] ?? '') : '';
      if (name) {
        winner = name;
        excerpt = sentence;
        break;
      }
    }
    if (winner) break;
  }

  // The amount next to the winner is the contract value; otherwise the first
  // amount in a sentence that talks about the award or its value.
  const awardy = /award|contract value|contract price|total|amount|successful/i;
  const moneySentence = (excerpt && MONEY.test(excerpt) ? excerpt : '') || all.find((s) => MONEY.test(s) && awardy.test(s)) || '';
  const money = moneySentence ? MONEY.exec(moneySentence) : null;
  const amountText = money ? collapse(money[0]) : '';
  const amount = money ? parseMoney(money[0]) : null;
  if (!excerpt && moneySentence) excerpt = moneySentence;

  const dateMatch = AWARD_DATE.exec(collapse(text ?? ''));
  const awardedOn = dateMatch ? isoDay(dateMatch[1]!, zone) : null;

  if (!winner && amount === null) return null;
  return { winner, amount, amountText, awardedOn, excerpt: excerpt.slice(0, 500) };
}

// Company endings and filler that differ between how a notice and a profile write a name.
const COMPANY_NOISE = /\b(?:ltd|limited|inc|incorporated|corp|corporation|co|company|ltee|llc|llp|the|and)\b/g;

function companyKey(name: string): string {
  return normalize(name).replace(/&/g, ' ').replace(COMPANY_NOISE, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** True when the winner named on a notice is the user's own company (legal or trade name). */
export function isOwnCompany(winner: string, names: string[]): boolean {
  const w = companyKey(winner);
  if (!w) return false;
  return names.some((n) => {
    const k = companyKey(n);
    return k !== '' && (k === w || w.startsWith(`${k} `) || k.startsWith(`${w} `));
  });
}
