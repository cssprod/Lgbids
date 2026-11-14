import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { DocumentLink, OpportunityStatus } from '../../shared/schemas.js';
import { extractReference } from '../matching/notice.js';
import { findClosingDate, findDates, parseDate, type ParseOptions } from '../util/dates.js';
import { collapse, findEmails, findPhone, tidyParagraphs, truncate } from '../util/text.js';
import type { RawOpportunity } from './types.js';

/**
 * Structure-agnostic reading of bid listing pages and notice pages.
 *
 * Municipal sites all lay their bid pages out differently, and they change
 * without notice. Rather than depend on one site's CSS classes, the listing
 * reader works from what such pages have in common: each opportunity is a
 * link, and the link sits in its own row, list item or card together with
 * the dates and reference number that belong to it.
 */

type $Root = cheerio.CheerioAPI;

const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'section', 'article', 'table', 'ul', 'ol', 'dl',
  'header', 'footer', 'blockquote', 'pre', 'hr', 'thead', 'tbody', 'caption', 'figure', 'address', 'fieldset', 'form', 'main',
]);
const CELL_TAGS = new Set(['td', 'th']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'select', 'button']);

/** Text of an element with line breaks at block boundaries and " | " between table cells. */
export function blockText($: $Root, root: AnyNode | null | undefined): string {
  if (!root) return '';
  const parts: string[] = [];
  const walk = (node: AnyNode): void => {
    if (node.type === 'text') {
      parts.push((node as unknown as { data: string }).data);
      return;
    }
    if (node.type !== 'tag') {
      if ('children' in node) for (const child of (node as Element).children) walk(child);
      return;
    }
    const el = node as Element;
    const tag = el.name.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push('\n');
    for (const child of el.children) walk(child);
    if (CELL_TAGS.has(tag)) parts.push(' | ');
    if (block) parts.push('\n');
  };
  walk(root);
  return tidyParagraphs(parts.join('').replace(/ \| (?=\n|$)/g, ''));
}

const PROCUREMENT_WORDS =
  /\b(?:RFP|RFQ|ITT|ITQ|RFSO|RFSQ|RFPQ|RFEOI|REOI|EOI|RFI|NOI|NRFP|ITB|IFB)\b|\b(?:request for|invitation to|call for|notice of intent|expression of interest|tender|quotation|proposal|standing offer|pre-?qualification)\b/i;
const PROCUREMENT_HREF = /(?:rfp|rfq|itt|tender|bid|quotation|proposal|opportunit|procurement|solicitation)/i;
const GENERIC_LINK_TEXT = /^(?:view|view details|details|more|read more|learn more|more info(?:rmation)?|download|click here|here|open|see details|full details|link|pdf|document)$/i;
const NOT_A_NOTICE = /^(?:home|contact(?: us)?|login|log in|sign in|register|subscribe|search|next|previous|prev|first|last|back|print|share|\d+|»|«|›|‹)$/i;
// Links found on bid pages that lead to archives, results and how-to pages rather than to a notice.
const SIDE_LINK =
  /\b(?:archive[sd]?|previous|past|closed|awarded|award results?|bid results|results|expired|how to|guide(?:lines)?|polic(?:y|ies)|faqs?|frequently asked|terms (?:and|&) conditions|register|registration|subscribe|sign up|notifications?|(?:vendor|supplier) (?:list|registration|portal)|purchasing (?:policy|department|division|services)|doing business|selling to|contact)\b/i;
const NUMBERED_NOTICE = /\b(?:RFP|RFQ|ITT|ITQ|RFSO|RFSQ|RFPQ|RFEOI|REOI|EOI|RFI|NOI|NRFP)\b.*\d/i;
const CHROME_SELECTOR = 'nav, header, footer, aside, .breadcrumb, .breadcrumbs, .pagination, .pager, .menu, .navbar, .sidebar, [role=navigation], [role=banner], [role=contentinfo]';
const MAIN_SELECTORS = ['main', '[role=main]', 'article', '#main-content', '#main', '#content', '.main-content', '.region-content', '.content'];

function resolve(href: string | undefined, base: string): URL | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(?:mailto|tel|javascript|data):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

// Query-string parameters that page, sort or filter a listing rather than name a notice.
const PAGING_PARAMS = new Set([
  'page', 'pn', 'p', 'pg', 'start', 'offset', 'sort', 'order', 'dir', 'per_page', 'perpage', 'limit', 'view', 'tab', 'lang',
  'q', 'search', 'keyword', 'keywords', 'filter', 'category', 'type', 'status',
]);

/** Is this link just the listing page again (itself, another page of it, or a re-sort)? */
function isSamePage(url: URL, page: URL): boolean {
  if (url.origin !== page.origin) return false;
  if (url.pathname.replace(/\/$/, '') !== page.pathname.replace(/\/$/, '')) return false;
  for (const [key, value] of url.searchParams) {
    if (!PAGING_PARAMS.has(key.toLowerCase()) && value && page.searchParams.get(key) !== value) return false;
  }
  return true;
}

function mainScope($: $Root): cheerio.Cheerio<Element> {
  for (const selector of MAIN_SELECTORS) {
    const found = $(selector).first();
    if (found.length && collapse(found.text()).length > 120) return found as cheerio.Cheerio<Element>;
  }
  return $('body').first() as cheerio.Cheerio<Element>;
}

export interface ListingOptions extends ParseOptions {
  /** Regular expression tested against each link's path + query string. */
  linkPattern?: string;
  /** CSS selector for one row / card. Overrides the automatic row detection. */
  itemSelector?: string;
  organization?: string;
}

interface Candidate {
  url: URL;
  anchor: Element;
  text: string;
}

const STATUS_WORDS: [RegExp, OpportunityStatus][] = [
  [/\b(?:awarded|award)\b/i, 'awarded'],
  [/\b(?:cancelled|canceled|withdrawn)\b/i, 'cancelled'],
  [/\b(?:closed|expired|complete[d]?)\b/i, 'closed'],
  [/\b(?:open|active|current|accepting)\b/i, 'open'],
];

function statusFrom(text: string): OpportunityStatus | undefined {
  for (const [re, status] of STATUS_WORDS) if (re.test(text)) return status;
  return undefined;
}

/** Label → value pairs found in a row, a definition list or "Label: value" lines. */
export function labelledFields($: $Root, container: cheerio.Cheerio<Element>, headers?: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  const put = (label: string, value: string) => {
    const key = collapse(label).replace(/[:：]\s*$/, '').toLowerCase();
    const val = collapse(value);
    if (key && val && key.length <= 60 && !fields.has(key)) fields.set(key, val);
  };

  // Table row with column headers.
  if (headers && headers.length > 0) {
    const cells = container.is('tr') ? container.children('td, th') : container.find('td');
    cells.each((i, cell) => {
      const header = headers[i];
      if (header) put(header, blockText($, cell).replace(/\n/g, ' '));
    });
  }
  // Two-cell rows: <th>Closing</th><td>...</td>
  container.find('tr').each((_, tr) => {
    const cells = $(tr).children('th, td');
    if (cells.length === 2) put($(cells[0]).text(), blockText($, cells[1]!).replace(/\n/g, ' '));
  });
  // Definition lists.
  container.find('dt').each((_, dt) => {
    const dd = $(dt).nextAll('dd').first();
    if (dd.length) put($(dt).text(), blockText($, dd[0]!).replace(/\n/g, ' '));
  });
  // <strong>Label:</strong> value, or a plain "Label: value" line.
  for (const line of blockText($, container[0]!).split('\n')) {
    const m = /^([A-Za-z][A-Za-z /&#.()'-]{1,48}?)\s*[:：]\s+(\S.*)$/.exec(line.trim());
    if (m) put(m[1]!, m[2]!);
  }
  return fields;
}

function pick(fields: Map<string, string>, include: RegExp, exclude?: RegExp): string {
  for (const [label, value] of fields) {
    if (include.test(label) && !(exclude && exclude.test(label))) return value;
  }
  return '';
}

const CLOSING_LABEL = /clos|deadline|due|end date|submission date|expir|bids? received/;
const NOT_CLOSING_LABEL = /question|inquir|enquir|site|meeting|award|addend|post|publish|issue/;
const PUBLISHED_LABEL = /post|publish|issue|open date|opening date|start date|release|date posted|^date$/;
const ORG_LABEL = /organi[sz]ation|buyer|entity|issued by|owner|agency|municipality|client|department|local government/;
const REF_LABEL = /^(?:ref|reference|number|no|id|bid|solicitation|tender|rfp|project)(?:erence)?(?: (?:no|number|#|id))?\.?$|reference (?:no|number|#)|solicitation (?:no|number)|bid (?:no|number|#)|tender (?:no|number|#)/;
const TYPE_LABEL = /^(?:type|notice type|solicitation type|bid type|opportunity type|category|classification)$/;
const STATUS_LABEL = /^status$/;

function fieldsToItem(fields: Map<string, string>, rowText: string, opts: ListingOptions): Partial<RawOpportunity> {
  const out: Partial<RawOpportunity> = {};
  const closingValue = pick(fields, CLOSING_LABEL, NOT_CLOSING_LABEL);
  if (closingValue) {
    out.closingRaw = truncate(closingValue, 120);
    const parsed = parseDate(closingValue, opts);
    if (parsed) out.closing = parsed;
  }
  const publishedValue = pick(fields, PUBLISHED_LABEL, /clos|deadline|due/);
  if (publishedValue) out.publishedAt = parseDate(publishedValue, opts)?.iso ?? null;

  if (!out.closing) {
    const labelled = findClosingDate(rowText, opts);
    if (labelled) {
      out.closing = { iso: labelled.iso, precision: labelled.precision };
      out.closingRaw = labelled.text;
    } else if (!closingValue) {
      // No label at all: a row with one date shows its closing date far more
      // often than its posting date, but only trust that for a date still ahead.
      // With two dates the later one is the closing.
      const dates = findDates(rowText, opts);
      const now = (opts.now ?? new Date()).getTime();
      if (dates.length === 1 && new Date(dates[0]!.iso).getTime() > now) {
        out.closing = { iso: dates[0]!.iso, precision: dates[0]!.precision };
        out.closingRaw = dates[0]!.text;
      } else if (dates.length === 2) {
        const [a, b] = dates[0]!.iso <= dates[1]!.iso ? [dates[0]!, dates[1]!] : [dates[1]!, dates[0]!];
        out.closing = { iso: b.iso, precision: b.precision };
        out.closingRaw = b.text;
        if (!out.publishedAt) out.publishedAt = a.iso;
      }
    }
  }

  const organization = pick(fields, ORG_LABEL);
  if (organization) out.organization = truncate(organization, 160);
  const reference = pick(fields, REF_LABEL);
  if (reference && reference.length <= 40) out.referenceNumber = reference;
  const type = pick(fields, TYPE_LABEL);
  if (type) out.noticeTypeHint = truncate(type, 80);
  const status = pick(fields, STATUS_LABEL);
  if (status) out.status = statusFrom(status);
  return out;
}

function tableHeaders($: $Root, row: cheerio.Cheerio<Element>): string[] {
  const table = row.closest('table');
  if (!table.length) return [];
  let headerCells = table.find('thead tr').first().children('th, td');
  if (!headerCells.length) headerCells = table.find('tr').first().children('th');
  return headerCells.map((_, cell) => collapse($(cell).text())).get();
}

/**
 * Read a page that lists bid opportunities and return one item per notice.
 */
export function extractListing(html: string, pageUrl: string, opts: ListingOptions = {}): RawOpportunity[] {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  const page = new URL(pageUrl);
  let pattern: RegExp | null = null;
  if (opts.linkPattern) {
    try {
      pattern = new RegExp(opts.linkPattern, 'i');
    } catch {
      pattern = null;
    }
  }

  // --- Explicit rows -----------------------------------------------------------
  if (opts.itemSelector) {
    const items: RawOpportunity[] = [];
    const seen = new Set<string>();
    $(opts.itemSelector).each((_, el) => {
      const row = $(el) as cheerio.Cheerio<Element>;
      let chosen: Candidate | null = null;
      row.find('a[href]').each((__, a) => {
        const url = resolve($(a).attr('href'), pageUrl);
        if (!url) return;
        const text = collapse($(a).text());
        if (pattern && !pattern.test(`${url.pathname}${url.search}`)) return;
        if (!chosen || (GENERIC_LINK_TEXT.test(chosen.text) && !GENERIC_LINK_TEXT.test(text)) || (!chosen.text && text)) {
          chosen = { url, anchor: a as Element, text };
        }
      });
      const item = buildItem($, row, chosen, page, opts);
      if (item && !seen.has(item.externalId)) {
        seen.add(item.externalId);
        items.push(item);
      }
    });
    return items;
  }

  // --- Automatic row detection ---------------------------------------------------
  const scope = pattern ? ($('body').first() as cheerio.Cheerio<Element>) : mainScope($);
  const items: RawOpportunity[] = [];
  const seen = new Set<string>();

  // A table with a "Closing" column is a bid listing whatever its links look
  // like: take every row.
  const handledTables: Element[] = [];
  if (!pattern) {
    scope.find('table').each((_, table) => {
      const first = $(table).find('tr').first();
      const headers = tableHeaders($, first as cheerio.Cheerio<Element>);
      if (!headers.some((h) => /clos|deadline|due date|end date/i.test(h))) return;
      handledTables.push(table as Element);
      $(table)
        .find('tr')
        .each((__, tr) => {
          const row = $(tr) as cheerio.Cheerio<Element>;
          if (row.children('td').length < 2) return;
          let chosen: Candidate | null = null;
          row.find('a[href]').each((___, a) => {
            const url = resolve($(a).attr('href'), pageUrl);
            if (!url) return;
            const text = collapse($(a).text());
            const better =
              !chosen ||
              (GENERIC_LINK_TEXT.test(chosen.text) && !GENERIC_LINK_TEXT.test(text)) ||
              (!GENERIC_LINK_TEXT.test(text) && text.length > chosen.text.length);
            if (better) chosen = { url, anchor: a as Element, text };
          });
          const item = buildItem($, row, chosen, page, opts);
          if (item && !seen.has(item.externalId)) {
            seen.add(item.externalId);
            items.push(item);
          }
        });
    });
  }

  const byUrl = new Map<string, Candidate>();
  scope.find('a[href]').each((_, a) => {
    const url = resolve($(a).attr('href'), pageUrl);
    if (!url) return;
    const text = collapse($(a).text());
    const pathAndQuery = `${url.pathname}${url.search}`;
    if (pattern) {
      if (!pattern.test(pathAndQuery)) return;
    } else {
      if ($(a).closest(CHROME_SELECTOR).length) return;
      if (handledTables.some((table) => $(a).closest(table).length > 0)) return;
      if (isSamePage(url, page)) return;
      if (NOT_A_NOTICE.test(text)) return;
      if (SIDE_LINK.test(text) && !NUMBERED_NOTICE.test(text)) return;
      const looksLikeNotice = PROCUREMENT_WORDS.test(text) || (PROCUREMENT_HREF.test(url.pathname) && text.length >= 12);
      if (!looksLikeNotice) return;
    }
    const key = url.toString();
    const existing = byUrl.get(key);
    const better =
      !existing ||
      (GENERIC_LINK_TEXT.test(existing.text) && !GENERIC_LINK_TEXT.test(text)) ||
      (!GENERIC_LINK_TEXT.test(text) && text.length > existing.text.length);
    if (better) byUrl.set(key, { url, anchor: a as Element, text });
  });

  const candidates = [...byUrl.values()];
  if (candidates.length === 0) return items;

  // How many different candidate links sit under each ancestor? The row for a
  // link is the largest ancestor that contains no other candidate.
  const counts = new Map<Element, Set<string>>();
  const scopeEl = scope[0]!;
  for (const c of candidates) {
    let node: Element | null = c.anchor;
    while (node) {
      let set = counts.get(node);
      if (!set) counts.set(node, (set = new Set()));
      set.add(c.url.toString());
      if (node === scopeEl) break;
      node = node.parent && node.parent.type === 'tag' ? (node.parent as Element) : null;
    }
  }

  for (const c of candidates) {
    let container: Element = c.anchor;
    for (;;) {
      const parent = container.parent && container.parent.type === 'tag' ? (container.parent as Element) : null;
      if (!parent || parent === scopeEl || parent.name === 'body' || parent.name === 'html') break;
      if ((counts.get(parent)?.size ?? 0) > 1) break;
      // A lone link on a page would otherwise swallow the whole page as its "row".
      if (collapse($(parent).text()).length > 1500) break;
      container = parent;
      if (container.name === 'tr' || container.name === 'li' || container.name === 'article') break;
    }
    const item = buildItem($, $(container) as cheerio.Cheerio<Element>, c, page, opts);
    if (item && !seen.has(item.externalId)) {
      seen.add(item.externalId);
      items.push(item);
    }
  }
  return items;
}

function buildItem(
  $: $Root,
  row: cheerio.Cheerio<Element>,
  candidate: Candidate | null,
  page: URL,
  opts: ListingOptions,
): RawOpportunity | null {
  const rowText = blockText($, row[0]!);
  let title = candidate?.text ?? '';
  if (!title || GENERIC_LINK_TEXT.test(title)) {
    const heading = collapse(row.find('h1, h2, h3, h4, h5, h6, .title, strong, b').first().text());
    title = heading || collapse(rowText.split('\n')[0] ?? '');
  }
  title = collapse(title.replace(/\s*\((?:pdf|opens in (?:a )?new (?:window|tab))[^)]*\)\s*$/i, ''));
  if (title.length < 4 || NOT_A_NOTICE.test(title)) return null;

  const headers = row.is('tr') ? tableHeaders($, row) : [];
  const fields = labelledFields($, row, headers);
  const extra = fieldsToItem(fields, rowText.replace(/\n/g, ' '), opts);
  const url = candidate?.url ?? page;
  const externalId = candidate ? `${url.pathname}${url.search}`.slice(0, 400) : `${page.pathname}#${title}`.slice(0, 400);

  const rest = collapse(rowText.replace(/\n/g, ' ')).replace(title, '').trim();
  const item: RawOpportunity = {
    externalId,
    title: truncate(title, 300),
    url: url.toString(),
    organization: extra.organization ?? opts.organization ?? '',
    referenceNumber: extra.referenceNumber ?? extractReference(title),
    noticeTypeHint: extra.noticeTypeHint ?? '',
    description: rest.length > 40 ? truncate(rest, 800) : '',
    publishedAt: extra.publishedAt ?? null,
    closing: extra.closing ?? null,
    closingRaw: extra.closingRaw ?? '',
    status: extra.status,
  };
  return item;
}

export interface DetailResult {
  title: string;
  description: string;
  fields: Map<string, string>;
  closing: { iso: string; precision: 'datetime' | 'date' } | null;
  closingRaw: string;
  publishedAt: string | null;
  organization: string;
  referenceNumber: string;
  noticeTypeHint: string;
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  documents: DocumentLink[];
  status: OpportunityStatus | undefined;
}

const DOCUMENT_HREF = /\.(?:pdf|docx?|xlsx?|zip|dwg)(?:[?#]|$)|\/media\/file\/|\/documents?\/|\/attachments?\/|download/i;

/** Read a single notice page: its text, labelled fields, dates and attached documents. */
export function extractDetail(html: string, pageUrl: string, opts: ParseOptions = {}): DetailResult {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  const docTitle = collapse($('title').first().text());
  $(CHROME_SELECTOR).remove();
  const main = mainScope($);
  const h1 = collapse(main.find('h1').first().text()) || collapse($('h1').first().text());
  const title = h1 || docTitle.split(/\s[|–-]\s/)[0] || '';

  const text = blockText($, main[0]!);
  const fields = labelledFields($, main);
  const flat = text.replace(/\n/g, ' ');

  let closing: DetailResult['closing'] = null;
  let closingRaw = '';
  const closingValue = pick(fields, CLOSING_LABEL, NOT_CLOSING_LABEL);
  if (closingValue) {
    closingRaw = truncate(closingValue, 120);
    closing = parseDate(closingValue, opts);
  }
  if (!closing) {
    const found = findClosingDate(flat, opts);
    if (found) {
      closing = { iso: found.iso, precision: found.precision };
      closingRaw = found.text;
    }
  }
  const publishedValue = pick(fields, PUBLISHED_LABEL, /clos|deadline|due/);
  const publishedAt = publishedValue ? (parseDate(publishedValue, opts)?.iso ?? null) : null;

  const documents: DocumentLink[] = [];
  const seenDocs = new Set<string>();
  main.find('a[href]').each((_, a) => {
    const url = resolve($(a).attr('href'), pageUrl);
    if (!url) return;
    const name = collapse($(a).text());
    const isDoc = DOCUMENT_HREF.test(`${url.pathname}${url.search}`) || /\((?:pdf|docx?|xlsx?)[^)]*\)|\bpdf\b/i.test(name);
    if (!isDoc || seenDocs.has(url.toString())) return;
    seenDocs.add(url.toString());
    documents.push({ name: truncate(name || decodeURIComponent(url.pathname.split('/').pop() ?? 'Document'), 160), url: url.toString() });
  });

  const contactValue = pick(fields, /contact|buyer name|purchasing agent|procurement (?:officer|contact|lead)|inquir|enquir/);
  const emails = findEmails(flat);
  const statusValue = pick(fields, STATUS_LABEL);

  return {
    title: truncate(title, 300),
    description: truncate(text, 15000),
    fields,
    closing,
    closingRaw,
    publishedAt,
    organization: truncate(pick(fields, ORG_LABEL), 160),
    referenceNumber: (() => {
      const ref = pick(fields, REF_LABEL);
      return ref && ref.length <= 40 ? ref : extractReference(title);
    })(),
    noticeTypeHint: truncate(pick(fields, /^(?:notice type|solicitation type|type|procurement method|bid type|opportunity type)$/), 80),
    location: truncate(pick(fields, /region|location|delivery|place of|site address|work location/), 200),
    contactName: truncate(contactValue.replace(/\S+@\S+/g, '').replace(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}.*/, '').trim(), 120),
    contactEmail: findEmails(contactValue)[0]?.email ?? emails[0]?.email ?? '',
    contactPhone: findPhone(contactValue) || '',
    documents: documents.slice(0, 25),
    status: statusValue ? statusFrom(statusValue) : undefined,
  };
}

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  published: string;
  categories: string[];
}

/** Parse an RSS 2.0 / RSS 1.0 / Atom feed. */
export function parseFeed(xml: string, feedUrl: string): { title: string; items: FeedItem[] } {
  const $ = cheerio.load(xml, { xml: { xmlMode: true, decodeEntities: true } });
  const items: FeedItem[] = [];
  const htmlToText = (value: string): string => {
    if (!value) return '';
    if (!/[<&]/.test(value)) return tidyParagraphs(value);
    const $$ = cheerio.load(`<div id="x">${value}</div>`);
    return blockText($$, $$('#x')[0]!);
  };
  const absolute = (href: string): string => resolve(href, feedUrl)?.toString() ?? '';

  $('item').each((_, el) => {
    const node = $(el);
    const link = collapse(node.children('link').first().text()) || node.children('link').first().attr('href') || '';
    const guid = collapse(node.children('guid').first().text());
    const title = htmlToText(node.children('title').first().text()).replace(/\n/g, ' ');
    if (!title) return;
    const url = absolute(link) || (/^https?:/i.test(guid) ? guid : '');
    items.push({
      id: guid || url || title,
      title,
      link: url,
      description: htmlToText(node.children('content\\:encoded').first().text() || node.children('description').first().text()),
      published: collapse(node.children('pubDate').first().text() || node.children('dc\\:date').first().text()),
      categories: node.children('category').map((__, c) => collapse($(c).text())).get().filter(Boolean),
    });
  });

  $('entry').each((_, el) => {
    const node = $(el);
    const links = node.children('link');
    const alternate = links.filter((__, l) => !$(l).attr('rel') || $(l).attr('rel') === 'alternate').first();
    const href = alternate.attr('href') ?? links.first().attr('href') ?? '';
    const title = htmlToText(node.children('title').first().text()).replace(/\n/g, ' ');
    if (!title) return;
    const id = collapse(node.children('id').first().text());
    items.push({
      id: id || absolute(href) || title,
      title,
      link: absolute(href),
      description: htmlToText(node.children('content').first().text() || node.children('summary').first().text()),
      published: collapse(node.children('published').first().text() || node.children('updated').first().text()),
      categories: node.children('category').map((__, c) => $(c).attr('term') ?? collapse($(c).text())).get().filter(Boolean),
    });
  });

  const title = collapse($('channel > title').first().text() || $('feed > title').first().text());
  return { title, items };
}
