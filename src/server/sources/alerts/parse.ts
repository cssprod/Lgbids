import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { extractReference } from '../../matching/notice.js';
import { findClosingDate, parseDate, type ParseOptions } from '../../util/dates.js';
import { collapse, truncate } from '../../util/text.js';
import { blockText, labelledFields } from '../extract.js';
import type { RawOpportunity } from '../types.js';

/**
 * Bid alert e-mails (BC Bid notifications, Bonfire "new opportunity" e-mails)
 * turned into notices.
 *
 * Neither site publishes its e-mail format, and the layouts change, so the
 * reader does not rely on one: it finds each notice by its link (a link to the
 * site itself, or a click-tracking link whose text reads like a title), then
 * reads the title, buyer, reference and closing date from the row or block
 * around that link. Plain-text e-mails are handled the same way.
 *
 * Only facts written in the e-mail are kept. Lgbids never opens the links:
 * BC Bid and Bonfire ask automated tools not to read their pages.
 */

export interface AlertEmail {
  from: string;
  subject: string;
  html: string;
  text: string;
  date: Date | null;
}

export type AlertSender = 'bcbid' | 'bonfire';

/** Words searched for in the From line on the mail server (case-insensitive substrings). */
export const ALERT_FROM_SEARCHES = ['bcbid', 'bonfire', 'euna'];

export function alertSender(from: string): AlertSender | null {
  if (/bc\s*bid|bcbid/i.test(from)) return 'bcbid';
  if (/bonfire|gobonfire|euna/i.test(from)) return 'bonfire';
  return null;
}

const SITE_HREF: Record<AlertSender, RegExp> = {
  bcbid: /(?:^|\.)bcbid\.gov\.bc\.ca$/i,
  bonfire: /(?:^|\.)bonfirehub\.(?:ca|com)$/i,
};

/** Links that are never a notice. */
const BOILERPLATE =
  /unsubscribe|preferences|manage (?:your )?(?:alerts|notifications|subscriptions)|privacy|terms|log ?in|sign ?in|password|help|support|contact us|view (?:this )?(?:e-?mail )?in (?:your )?browser|facebook|twitter|linkedin|instagram|youtube|mailto:|download the app|^https?:\/\/[^/]+\/?$/i;
/** Call-to-action link text: the title has to come from the block around it. */
const CALL_TO_ACTION = /^(?:view|see|open|go to|read|more|details|click here|here|learn more|respond|bid now|view (?:the )?(?:opportunity|project|notice|details|bid)|view opportunity details?)\b.{0,30}$/i;
const NOT_TITLE_LINE = /^(?:[A-Za-z][A-Za-z /#.()'-]{1,40}:|https?:\/\/|new (?:opportunit|bid|notice)|you are receiving|hello|hi |dear )/i;

export const BONFIRE_BUYERS: Record<string, string> = {
  victoria: 'City of Victoria',
  saanich: 'District of Saanich',
  centralsaanich: 'District of Central Saanich',
  northsaanich: 'District of North Saanich',
  uvic: 'University of Victoria',
  crd: 'Capital Regional District',
  esquimalt: 'Township of Esquimalt',
  oakbay: 'District of Oak Bay',
  langford: 'City of Langford',
  colwood: 'City of Colwood',
  viewroyal: 'Town of View Royal',
  sidney: 'Town of Sidney',
  sooke: 'District of Sooke',
  metchosin: 'District of Metchosin',
  camosun: 'Camosun College',
  royalroads: 'Royal Roads University',
};

const ORG_LABEL = /^(?:organi[sz]ation|buyer|issued by|owner|agency|entity|department|public body|municipality|client)$/;
const REF_LABEL = /^(?:opportunity (?:id|no|number|#)|reference(?: (?:no|number|#))?|ref(?:erence)? ?#?|solicitation (?:no|number)|project (?:id|no|number)|bid (?:no|number|#)|competition (?:no|number))$/;
const TYPE_LABEL = /^(?:type|opportunity type|solicitation type|notice type|bid type)$/;
const CLOSING_LABEL = /clos|deadline|due date|submission deadline/;
const TITLE_LABEL = /^(?:title|opportunity|opportunity title|project|project name|description|bid title|name)$/;

function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((chunk) => `<div>${chunk.split('\n').map((line) => esc(line).replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1">$1</a>')).join('<br>')}</div>`)
    .join('\n');
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return '';
  }
}

/** The smallest block around the link that holds more than the link itself. */
function blockAround($: cheerio.CheerioAPI, a: cheerio.Cheerio<Element>, linkText: string): cheerio.Cheerio<Element> {
  let el = a.parent();
  for (let depth = 0; depth < 6 && el.length; depth++) {
    const tag = (el[0] as Element).tagName?.toLowerCase();
    const len = collapse(el.text()).length;
    const links = el.find('a[href]').length;
    if (['tr', 'li', 'td', 'div', 'p', 'table', 'section'].includes(tag ?? '') && len >= linkText.length + 25) {
      // A block holding several notices is too wide: stop at the last one that held only this link.
      if (links > 2) break;
      return el;
    }
    el = el.parent();
  }
  return a.parent();
}

/** Column headers when the block is a table row, so each cell gets its label. */
function headersFor($: cheerio.CheerioAPI, block: cheerio.Cheerio<Element>): string[] | undefined {
  if ((block[0] as Element | undefined)?.tagName?.toLowerCase() !== 'tr') return undefined;
  const table = block.closest('table');
  let cells = table.find('thead tr').first().children('th, td');
  if (!cells.length) cells = table.find('tr').first().children('th');
  return cells.length ? cells.map((_, c) => collapse($(c).text())).get() : undefined;
}

function pick(fields: Map<string, string>, re: RegExp): string {
  for (const [label, value] of fields) if (re.test(label)) return value;
  return '';
}

function titleFromBlock(lines: string[], fields: Map<string, string>): string {
  const labelled = pick(fields, TITLE_LABEL);
  if (labelled) return labelled;
  return lines.find((l) => l.length >= 8 && !NOT_TITLE_LINE.test(l) && !CALL_TO_ACTION.test(l) && !BOILERPLATE.test(l)) ?? '';
}

function buyerFromSubject(subject: string): string {
  const m = /(?:from|by|posted by|issued by)\s+(.+?)(?:\s+(?:on|via)\s+(?:bonfire|bc ?bid).*)?$/i.exec(subject);
  return m ? collapse(m[1]).replace(/[.:!]+$/, '') : '';
}

function bonfireBuyer(host: string): string {
  const sub = host.toLowerCase().replace(/\.bonfirehub\.(?:ca|com)$/, '');
  if (!sub || sub === host.toLowerCase() || sub === 'www') return '';
  return BONFIRE_BUYERS[sub] ?? sub.replace(/(^|-)([a-z])/g, (_, s: string, c: string) => `${s ? ' ' : ''}${c.toUpperCase()}`);
}

function keyOf(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Read one alert e-mail. Returns no notices for mail from other senders. */
export function parseAlertEmail(mail: AlertEmail, opts: ParseOptions = {}): RawOpportunity[] {
  const sender = alertSender(mail.from);
  if (!sender) return [];
  const html = mail.html.trim() ? mail.html : textToHtml(mail.text);
  const $ = cheerio.load(html);
  $('script, style, head, title').remove();

  const out: RawOpportunity[] = [];
  const seen = new Set<string>();
  const subjectBuyer = buyerFromSubject(mail.subject);

  $('a[href]').each((_, node) => {
    const a = $(node);
    const href = (a.attr('href') ?? '').trim();
    if (!/^https?:\/\//i.test(href)) return;
    const linkText = collapse(a.text());
    if (BOILERPLATE.test(href) || BOILERPLATE.test(linkText)) return;

    const host = hostOf(href);
    const toSite = SITE_HREF[sender].test(host);
    const textIsUrl = /^https?:\/\//i.test(linkText);
    const isCta = CALL_TO_ACTION.test(linkText) || textIsUrl;
    // A tracking link counts only when its text reads like a notice title or a call to action.
    if (!toSite && !isCta && linkText.length < 12) return;
    // A link straight to the site's front page or a search page is not a notice.
    if (toSite && /^\/?(?:$|portal\/?$|login)/i.test(new URL(href).pathname) && !/[?&](?:id|projectId)=/i.test(href)) return;

    const block = blockAround($, a, linkText);
    const blockRoot = block[0] as AnyNode | undefined;
    const raw = blockRoot ? blockText($, blockRoot) : linkText;
    const lines = raw
      .split('\n')
      .map((l) => collapse(l))
      .filter(Boolean);
    const fields = labelledFields($, block as cheerio.Cheerio<Element>, headersFor($, block));

    const title = truncate(isCta ? titleFromBlock(lines, fields) : linkText, 300);
    if (!title || title.length < 6) return;

    const flat = lines.join(' \n ');
    const closingLabelled = pick(fields, CLOSING_LABEL);
    const closing = (closingLabelled ? parseDate(closingLabelled, opts) : null) ?? (() => {
      const found = findClosingDate(flat.replace(/\n/g, ' '), opts);
      return found ? { iso: found.iso, precision: found.precision } : null;
    })();
    const organization = pick(fields, ORG_LABEL) || (sender === 'bonfire' && toSite ? bonfireBuyer(host) : '') || subjectBuyer;
    const reference = pick(fields, REF_LABEL);

    const key = toSite ? `${host}${new URL(href).pathname}${new URL(href).search}` : `${keyOf(organization)}|${keyOf(title)}`;
    if (seen.has(key)) return;
    seen.add(key);

    out.push({
      externalId: truncate(`alert:${sender}:${key}`, 400),
      title,
      url: href,
      organization: organization ? truncate(organization, 160) : undefined,
      referenceNumber: reference && reference.length <= 40 ? reference : extractReference(title) || undefined,
      noticeTypeHint: truncate(pick(fields, TYPE_LABEL), 80) || undefined,
      description: truncate(lines.filter((l) => !BOILERPLATE.test(l)).join('\n'), 4000),
      publishedAt: mail.date ? mail.date.toISOString().replace(/\.\d{3}Z$/, 'Z') : null,
      closing,
      closingRaw: closingLabelled || '',
      status: 'open',
      bcSource: true,
    });
  });
  return out;
}
