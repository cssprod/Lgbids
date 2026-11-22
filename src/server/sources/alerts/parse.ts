import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { extractReference } from '../../matching/notice.js';
import { findClosingDate, parseDate, type ParseOptions } from '../../util/dates.js';
import { BUYERS } from '../../../shared/buyers.js';
import { collapse, truncate } from '../../util/text.js';
import { blockText, labelledFields } from '../extract.js';
import type { RawOpportunity } from '../types.js';

/** What an alert e-mail announces (mirrors `NoticeEvent` in schemas.ts, which is frozen this wave). */
export type AlertKind = 'new' | 'addendum' | 'closing_change' | 'award' | 'cancelled' | 'other';
export interface AlertReading {
  kind: AlertKind;
  items: RawOpportunity[];
}

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

export type AlertSender = 'bcbid' | 'bonfire' | 'canadabuys' | 'bidsandtenders' | 'merx' | 'biddingo';

/** Words searched for in the From line on the mail server (case-insensitive substrings). */
export const ALERT_FROM_SEARCHES = ['bcbid', 'bc bid', 'bonfire', 'gobonfire', 'bonfirehub', 'euna', 'canadabuys', 'bidsandtenders', 'merx', 'biddingo'];

export function alertSender(from: string): AlertSender | null {
  if (/canadabuys|achatscanada/i.test(from)) return 'canadabuys';
  if (/bidsandtenders|bids\s*(?:&|&amp;|and)\s*tenders/i.test(from)) return 'bidsandtenders';
  if (/\bmerx\b/i.test(from)) return 'merx';
  if (/biddingo/i.test(from)) return 'biddingo';
  if (/bc\s*bid|bcbid/i.test(from)) return 'bcbid';
  if (/bonfire|gobonfire|euna/i.test(from)) return 'bonfire';
  return null;
}

const SITE_HREF: Record<AlertSender, RegExp> = {
  bcbid: /(?:^|\.)bcbid\.gov\.bc\.ca$/i,
  bonfire: /(?:^|\.)bonfirehub\.(?:ca|com)$/i,
  canadabuys: /(?:^|\.)(?:canadabuys|achatscanada)\.canada\.ca$/i,
  bidsandtenders: /(?:^|\.)bidsandtenders\.(?:ca|net|com)$/i,
  merx: /(?:^|\.)merx\.com$/i,
  biddingo: /(?:^|\.)biddingo\.com$/i,
};

/**
 * Times written without a zone: national services in Eastern time (the
 * cautious reading, as for CanadaBuys; MERX per D9), BC services in Pacific.
 */
const SENDER_ZONE: Partial<Record<AlertSender, string>> = { canadabuys: 'America/Toronto', merx: 'America/Toronto' };
/** Senders that only carry BC public bodies. */
const BC_SENDERS = new Set<AlertSender>(['bcbid', 'bonfire']);
/** Words that place a national notice in British Columbia. */
const BC_CUE =
  /\b(?:British Columbia|Colombie-Britannique|B\.C\.|BC|Vancouver Island|Victoria|Saanich|Esquimalt|Oak Bay|Langford|Colwood|View Royal|Sooke|Sidney|Metchosin|Highlands|Nanaimo)\b/;

/** Links that are never a notice. */
const BOILERPLATE =
  /unsubscribe|preferences|manage (?:your )?(?:alerts|notifications|subscriptions)|privacy|terms|log ?in|sign ?in|password|help|support|contact us|view (?:this )?(?:e-?mail )?in (?:your )?browser|facebook|twitter|linkedin|instagram|youtube|mailto:|download the app|^https?:\/\/[^/]+\/?$/i;
/** Call-to-action link text: the title has to come from the block around it. */
const CALL_TO_ACTION = /^(?:view|see|open|go to|read|more|details|click here|here|learn more|respond|bid now|view (?:the )?(?:opportunity|project|notice|details|bid)|view opportunity details?)\b.{0,30}$/i;
const NOT_TITLE_LINE = /^(?:[A-Za-z][A-Za-z /#.()'-]{1,40}:|https?:\/\/|new (?:opportunit|bid|notice)|you are receiving|hello|hi |dear )|has posted|posted a new|matching your|you are receiving/i;
/** An ID-like text (a reference, not a title). */
const ID_LIKE = /^(?=.*\d)(?!.*[A-Za-z]{4})[A-Z0-9][A-Z0-9 ./#_-]{0,30}$/i;
/** Account, marketing and event mail from the same senders: never notices. */
const NOT_AN_ALERT =
  /\b(?:password|verify your (?:e-?mail|account)|account (?:activation|locked|created|update|registration)|activate your account|security code|sign-?in code|one-time (?:code|passcode)|newsletter|webinar|register now for|product update|what'?s new in|customer story|survey)\b/i;

/** Portal subdomain → buyer name, from the shared buyer registry (each buyer's id and its Bonfire / bids&tenders subdomains). */
export const BONFIRE_BUYERS: Record<string, string> = Object.fromEntries(
  BUYERS.flatMap((b) => [
    [b.id, b.name] as [string, string],
    ...b.channels.flatMap((c) => (/^(?:bonfire|bidsandtenders):/.test(c) ? [[c.slice(c.indexOf(':') + 1), b.name] as [string, string]] : [])),
  ]),
);

const ORG_LABEL = /^(?:organi[sz]ation|buyer|issued by|owner|agency|entity|department|public body|municipality|client)$/;
const REF_LABEL = /^(?:opportunity (?:id|no|number|#)|reference(?: (?:no|number|#))?|ref(?:erence)? ?#?|solicitation (?:no|number)|project (?:id|no|number)|bid (?:no|number|#)|competition (?:no|number))$/;
const TYPE_LABEL = /^(?:type|opportunity type|solicitation type|notice type|bid type)$/;
const CLOSING_LABEL = /clos|deadline|due date|submission deadline/;
const TITLE_LABEL = /^(?:title|opportunity|opportunity title|project|project name|description|bid title|name)$/;

/** A URL in plain text loses the punctuation that closes the sentence or the `<…>` around it. */
function trimUrl(url: string): string {
  let u = url.replace(/&gt;.*$/, '');
  while (/[>).,;:!?'\]]$/.test(u)) u = u.slice(0, -1);
  return u;
}

function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((chunk) =>
      `<div>${chunk
        .split('\n')
        .map((line) =>
          esc(line).replace(/(https?:\/\/[^\s<>"]+)/g, (m: string) => {
            const url = trimUrl(m);
            return `<a href="${url}">${url}</a>${m.slice(url.length)}`;
          }),
        )
        .join('<br>')}</div>`,
    )
    .join('\n');
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return '';
  }
}

/** Distinct notice-like links inside an element (boilerplate links do not count). */
function noticeLinks($: cheerio.CheerioAPI, el: cheerio.Cheerio<Element>): number {
  const hrefs = new Set<string>();
  el.find('a[href]').each((_, n) => {
    const href = ($(n).attr('href') ?? '').trim();
    if (/^https?:\/\//i.test(href) && !BOILERPLATE.test(href) && !BOILERPLATE.test(collapse($(n).text()))) hrefs.add(href);
  });
  return hrefs.size;
}

const BLOCK_TAGS = ['tr', 'li', 'td', 'div', 'p', 'table', 'section', 'tbody', 'center', 'article'];

/**
 * The block around the link that describes one notice. A table row under
 * column headers is the whole row. Otherwise walk up (about 12 levels, which
 * covers the nested layout tables of HTML e-mails) and stop at the first block
 * that has a heading or labelled fields, or at the last one before the block
 * would hold a second notice. When the whole e-mail holds one notice, the body is it.
 */
function blockAround($: cheerio.CheerioAPI, a: cheerio.Cheerio<Element>, linkText: string, single: boolean): cheerio.Cheerio<Element> {
  const tr = a.closest('tr');
  if (tr.length && headersFor($, tr as cheerio.Cheerio<Element>)) return tr as cheerio.Cheerio<Element>;
  let el = a.parent();
  let first: cheerio.Cheerio<Element> | null = null;
  for (let depth = 0; depth < 12 && el.length; depth++) {
    const tag = (el[0] as Element).tagName?.toLowerCase() ?? '';
    if (tag === 'body' || tag === 'html') break;
    if (noticeLinks($, el) > 1) break;
    if (BLOCK_TAGS.includes(tag) && collapse(el.text()).length >= linkText.length + 25) {
      if (el.find('h1, h2, h3, h4, h5, h6').length || labelledFields($, el).size) return el;
      first ??= el;
    }
    el = el.parent();
  }
  if (first) return first;
  if (single) {
    const body = $('body');
    if (body.length) return body as cheerio.Cheerio<Element>;
  }
  return a.parent();
}

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
  const headed = lines.find((l) => l.length >= 8 && !NOT_TITLE_LINE.test(l) && !CALL_TO_ACTION.test(l) && !BOILERPLATE.test(l) && !ID_LIKE.test(l));
  return headed ?? '';
}

function buyerFromSubject(subject: string): string {
  const m = /(?:from|by|posted by|issued by)\s+(.+?)(?:\s+(?:on|via)\s+(?:bonfire|bc ?bid).*)?$/i.exec(subject);
  return m ? collapse(m[1]).replace(/[.:!]+$/, '') : '';
}

/** The buyer named by a portal subdomain (victoria.bonfirehub.ca, sidney.bidsandtenders.ca). */
function portalBuyer(host: string): string {
  const sub = host.toLowerCase().replace(/\.(?:bonfirehub\.(?:ca|com)|bidsandtenders\.(?:ca|net|com))$/, '');
  if (!sub || sub === host.toLowerCase() || sub === 'www') return '';
  return BONFIRE_BUYERS[sub] ?? sub.replace(/(^|-)([a-z])/g, (_, s: string, c: string) => `${s ? ' ' : ''}${c.toUpperCase()}`);
}

function keyOf(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Prefer a title that reads like words over an ID, then the longer one. */
function betterTitle(a: string, b: string): boolean {
  const idA = ID_LIKE.test(a);
  const idB = ID_LIKE.test(b);
  if (idA !== idB) return idB;
  return a.length > b.length;
}

/** The cell of a table row that holds the link, with its column header. */
function cellHeader($: cheerio.CheerioAPI, a: cheerio.Cheerio<Element>, block: cheerio.Cheerio<Element>, headers: string[] | undefined): string {
  if (!headers) return '';
  const cell = a.closest('td, th');
  const idx = block.children('td, th').index(cell);
  return idx >= 0 ? (headers[idx] ?? '').toLowerCase() : '';
}

const CANCEL_CUE = /\b(?:cancell?ed|cancell?ation|withdrawn|rescinded)\b/i;
const AWARD_CUE = /\b(?:award(?:ed)?|contract award|successful (?:bidder|proponent)|award notice)\b/i;
const ADDENDUM_CUE = /\b(?:addend(?:um|a)|amendment|amended)\b/i;
const CLOSING_CUE = /\b(?:closing (?:date |time )?(?:has )?(?:been )?(?:changed|extended|moved|revised|updated)|extended closing|new closing|deadline (?:extended|changed)|extension)\b/i;

function kindOf(subject: string, text: string): AlertKind {
  const head = `${subject}\n${text.slice(0, 600)}`;
  if (CANCEL_CUE.test(head)) return 'cancelled';
  if (AWARD_CUE.test(subject) || /\bhas been awarded\b/i.test(head)) return 'award';
  if (ADDENDUM_CUE.test(head)) return 'addendum';
  if (CLOSING_CUE.test(head)) return 'closing_change';
  return 'new';
}

/** Read one alert e-mail: what it announces, and the notices it is about. */
export function readAlertEmail(mail: AlertEmail, baseOpts: ParseOptions = {}): AlertReading {
  const sender = alertSender(mail.from);
  if (!sender) return { kind: 'other', items: [] };
  const zone = SENDER_ZONE[sender];
  const opts: ParseOptions = zone ? { ...baseOpts, zone } : baseOpts;
  const html = mail.html.trim() ? mail.html : textToHtml(mail.text);
  const $ = cheerio.load(html);
  $('script, style, head, title').remove();
  const bodyText = collapse($('body').text() || mail.text);
  // Account, password, newsletter and webinar mail from the same senders.
  if (NOT_AN_ALERT.test(mail.subject) || (!/opportunit|bid|tender|rfp|rfq|quot|solicitation|notice/i.test(mail.subject) && NOT_AN_ALERT.test(bodyText.slice(0, 400)))) {
    return { kind: 'other', items: [] };
  }
  const kind = kindOf(mail.subject, bodyText);

  const out: RawOpportunity[] = [];
  const byKey = new Map<string, number>();
  const byHref = new Map<string, number>();
  const subjectBuyer = buyerFromSubject(mail.subject);
  const single = noticeLinks($, $('body') as cheerio.Cheerio<Element>) === 1;

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

    const block = blockAround($, a, linkText, single);
    const headers = headersFor($, block);
    // In a table row, links in the ID or organization column are not the notice's title.
    const column = cellHeader($, a, block, headers);
    if (column && (REF_LABEL.test(column) || ORG_LABEL.test(column))) {
      if (block.find('a[href]').length > 1) return;
    }
    const blockRoot = block[0] as AnyNode | undefined;
    const raw = blockRoot ? blockText($, blockRoot) : linkText;
    const lines = raw
      .split('\n')
      .map((l) => collapse(l))
      .filter(Boolean);
    const fields = labelledFields($, block as cheerio.Cheerio<Element>, headers);

    const useBlockTitle = isCta || ID_LIKE.test(linkText) || (column !== '' && (REF_LABEL.test(column) || ORG_LABEL.test(column)));
    const title = truncate(useBlockTitle ? titleFromBlock(lines, fields) : linkText, 300);
    if (!title || title.length < 6) return;

    // The same notice linked twice (title and button): keep one, with the better title.
    const seenHref = byHref.get(href);
    if (seenHref !== undefined) {
      const prev = out[seenHref]!;
      if (betterTitle(title, prev.title)) prev.title = title;
      return;
    }

    const flat = lines.join(' \n ');
    const closingLabelled = pick(fields, CLOSING_LABEL);
    const closing = (closingLabelled ? parseDate(closingLabelled, opts) : null) ?? (() => {
      const found = findClosingDate(flat.replace(/\n/g, ' '), opts);
      return found ? { iso: found.iso, precision: found.precision } : null;
    })();
    const organization = pick(fields, ORG_LABEL) || ((sender === 'bonfire' || sender === 'bidsandtenders') && toSite ? portalBuyer(host) : '') || subjectBuyer;
    const reference = pick(fields, REF_LABEL);

    // Bilingual mail (CanadaBuys) links the English and French pages of one
    // notice: drop the language from the link, and prefer the reference.
    const linkKey = (() => {
      const u = new URL(href);
      for (const p of ['lang', 'language', 'locale']) u.searchParams.delete(p);
      return `${host}${u.pathname.replace(/\/(?:en|fr)(?=\/|$)/i, '')}${u.search}`;
    })();
    const key =
      sender === 'canadabuys' && reference ? `ref:${keyOf(reference)}` : toSite ? linkKey : `${keyOf(organization)}|${keyOf(title)}`;
    if (byKey.has(key)) return;
    byKey.set(key, out.length);
    byHref.set(href, out.length);

    const item: RawOpportunity = {
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
      bcSource: BC_SENDERS.has(sender) || BC_CUE.test(`${organization}\n${flat}`),
    };
    if (kind === 'addendum') item.event = 'addendum';
    else if (kind === 'closing_change') item.event = 'closing_change';
    else if (kind === 'award') {
      item.event = 'award';
      item.status = 'awarded';
    } else if (kind === 'cancelled') {
      item.event = 'cancellation';
      item.status = 'cancelled';
    }
    out.push(item);
  });
  return { kind, items: out };
}

/** Read one alert e-mail. Returns no notices for mail from other senders. */
export function parseAlertEmail(mail: AlertEmail, opts: ParseOptions = {}): RawOpportunity[] {
  return readAlertEmail(mail, opts).items;
}
