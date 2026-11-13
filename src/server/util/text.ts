import { createHash } from 'node:crypto';

/** Collapse runs of whitespace (including non-breaking spaces) and trim. */
export function collapse(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/[\s ​﻿]+/g, ' ').trim();
}

/** Like collapse, but keeps paragraph breaks so long descriptions stay readable. */
export function tidyParagraphs(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ​﻿]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Lower-case, strip accents and punctuation. Used wherever two pieces of text
 * from different sites need to be compared.
 */
export function normalize(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slugify(input: string, max = 60): string {
  return normalize(input).replace(/ /g, '-').slice(0, max).replace(/-+$/, '');
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function uniq<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

export function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

/**
 * Build a regular expression that matches a plain phrase as whole words inside
 * text that has been through normalize(). Returns null for phrases that
 * normalise to nothing.
 */
export function phraseRegex(phrase: string): RegExp | null {
  const n = normalize(phrase);
  if (!n) return null;
  return new RegExp(`(?:^| )${escapeRegex(n)}(?= |$)`);
}

/** True when the normalised phrase occurs as whole words in the normalised text. */
export function containsPhrase(normalizedText: string, phrase: string): boolean {
  const re = phraseRegex(phrase);
  return re ? re.test(normalizedText) : false;
}

const EMAIL_RE = /[A-Z0-9][A-Z0-9._%+-]*@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)*\.[A-Z]{2,}/gi;

/** Every e-mail address in the text, lower-cased, in order of appearance. */
export function findEmails(text: string): { email: string; index: number }[] {
  const out: { email: string; index: number }[] = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    out.push({ email: m[0].replace(/\.+$/, '').toLowerCase(), index: m.index });
  }
  return out;
}

const STRICT_EMAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/i;

export function isEmail(input: string | null | undefined): boolean {
  return !!input && input.length <= 254 && STRICT_EMAIL.test(input);
}

/** Split a comma/semicolon separated list of addresses, dropping anything invalid. */
export function parseEmailList(input: string | null | undefined): string[] {
  if (!input) return [];
  return uniq(
    input
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => isEmail(s)),
  );
}

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/i;

export function findPhone(text: string): string {
  const m = PHONE_RE.exec(text);
  return m ? collapse(m[0]) : '';
}

export function formatMoney(amount: number, opts: { cents?: boolean } = {}): string {
  const digits = opts.cents ?? !Number.isInteger(amount) ? 2 : 0;
  return `$${amount.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Parse "$5,000,000", "$5 million", "5M", "$2.5M" into dollars. */
export function parseMoney(input: string): number | null {
  const m = /\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(million|mil\b|mm\b|m\b|thousand|k\b)?/i.exec(input);
  if (!m) return null;
  let value = Number(`${m[1]!.replace(/,/g, '')}${m[2] ?? ''}`);
  if (!Number.isFinite(value)) return null;
  const unit = (m[3] ?? '').toLowerCase();
  if (unit.startsWith('m')) value *= 1_000_000;
  else if (unit.startsWith('k') || unit.startsWith('t')) value *= 1_000;
  return value;
}
