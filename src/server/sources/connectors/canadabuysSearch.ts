import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { SourceRecord } from '../../../shared/schemas.js';
import { mightBeLocal } from '../../matching/geo.js';
import { DEFAULT_SEARCH_QUERIES } from '../../matching/relevance.js';
import { extractReference } from '../../matching/notice.js';
import { findDates, parseDate } from '../../util/dates.js';
import { collapse, truncate } from '../../util/text.js';
import { blockText, extractDetail, labelledFields } from '../extract.js';
import type { Connector, ConnectorContext, ListResult, RawOpportunity } from '../types.js';

/**
 * CanadaBuys website search.
 *
 * Besides federal tenders, the CanadaBuys site republishes notices from
 * provincial systems, including BC Bid — which is where almost every Greater
 * Victoria municipality, school district and college posts. Those mirrored
 * notices are not in the open-data CSV, so they are found by searching the
 * site for landscaping terms. Their identifiers start with "bc"
 * (e.g. /tender-opportunities/tender-notice/bc231314).
 *
 * BC Bid itself puts a browser check in front of its public listing, so it is
 * not read directly.
 */

export const CANADABUYS_SEARCH_URL =
  'https://canadabuys.canada.ca/en/tender-opportunities?search_filter={query}&status%5B87%5D=87&record_per_page=200&current_tab=t&words={query}';

const NOTICE_PATH = /\/tender-opportunities\/tender-notice\/([^/?#]+)/i;

/** Read one page of search results. Works from the notice links, not the page layout. */
export function parseSearchResults(html: string, pageUrl: string, now: Date): RawOpportunity[] {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const byId = new Map<string, RawOpportunity>();

  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const match = NOTICE_PATH.exec(href);
    if (!match) return;
    const id = decodeURIComponent(match[1]!).toLowerCase();
    const title = collapse($(a).text());
    if (title.length < 4) return;
    const existing = byId.get(id);
    if (existing && existing.title.length >= title.length) return;

    let url: string;
    try {
      const u = new URL(href, pageUrl);
      u.search = '';
      u.hash = '';
      url = u.toString();
    } catch {
      return;
    }

    const row = ($(a).closest('tr').length ? $(a).closest('tr') : $(a).closest('li, article, .views-row, div')) as cheerio.Cheerio<Element>;
    const item: RawOpportunity = { externalId: id, title: truncate(title, 300), url, bcSource: id.startsWith('bc') };

    if (row.length) {
      const table = row.closest('table');
      const headers = table.length
        ? (table.find('thead tr').first().children('th, td').length
            ? table.find('thead tr').first().children('th, td')
            : table.find('tr').first().children('th')
          )
            .map((__, cell) => collapse($(cell).text()))
            .get()
        : [];
      const fields = labelledFields($, row, headers);
      for (const [label, value] of fields) {
        if (/clos/.test(label) && !item.closing) {
          item.closingRaw = truncate(value, 80);
          item.closing = parseDate(value, { zone: 'America/Toronto', now });
        } else if (/open|amend|publi|posted/.test(label) && !item.publishedAt) {
          item.publishedAt = parseDate(value, { zone: 'America/Toronto', now })?.iso ?? null;
        } else if (/organi[sz]ation|entity|buyer/.test(label) && !item.organization) {
          item.organization = truncate(value, 160);
        } else if (/categor|type/.test(label) && !item.noticeTypeHint) {
          item.categories = [truncate(value, 120)];
        }
      }
      // No usable header row: take the dates and the last cell as they come.
      if (!item.closing) {
        const rowText = blockText($, row[0]!).replace(/\n/g, ' ');
        const dates = findDates(rowText, { zone: 'America/Toronto', now });
        const last = dates[dates.length - 1];
        if (last && dates.length >= 2) {
          item.closing = { iso: last.iso, precision: last.precision };
          item.closingRaw = last.text;
          item.publishedAt = item.publishedAt ?? dates[0]!.iso;
        }
      }
      if (!item.organization && row.is('tr')) {
        const cells = row.children('td');
        const lastCell = collapse(cells.last().text());
        if (cells.length >= 3 && lastCell && lastCell !== title && !/\d{4}/.test(lastCell)) item.organization = truncate(lastCell, 160);
      }
    }
    item.referenceNumber = extractReference(title);
    byId.set(id, item);
  });
  return [...byId.values()];
}

/** Read one CanadaBuys notice page. */
export function parseNotice(html: string, pageUrl: string, now: Date): Partial<RawOpportunity> {
  const detail = extractDetail(html, pageUrl, { zone: 'America/Toronto', now });
  const get = (re: RegExp): string => {
    for (const [label, value] of detail.fields) if (re.test(label)) return value;
    return '';
  };
  const regions = [get(/region(?:s)? of delivery/), get(/region(?:s)? of opportunity/)].filter(Boolean).join('; ');
  const out: Partial<RawOpportunity> = {
    description: detail.description,
    documents: detail.documents,
  };
  if (detail.closing) {
    out.closing = detail.closing;
    out.closingRaw = detail.closingRaw;
  }
  if (detail.publishedAt) out.publishedAt = detail.publishedAt;
  const organization = get(/^(?:organi[sz]ation|contracting (?:entity|organization)|entity name|buyer|end user)/) || detail.organization;
  if (organization) out.organization = truncate(organization, 160);
  const solicitation = get(/solicitation (?:number|no)|reference number/);
  if (solicitation && solicitation.length <= 60) out.referenceNumber = solicitation;
  const type = get(/^notice type|procurement method|solicitation type/);
  if (type) out.noticeTypeHint = truncate(type, 100);
  if (regions || detail.location) out.location = truncate(regions || detail.location, 300);
  const unspsc = get(/unspsc|commodity|gsin/);
  if (unspsc) out.categories = [truncate(unspsc, 300)];
  if (detail.contactName) out.contactName = detail.contactName;
  if (detail.contactEmail) out.contactEmail = detail.contactEmail;
  if (detail.contactPhone) out.contactPhone = detail.contactPhone;
  if (/british columbia|colombie-britannique/i.test(`${regions} ${detail.location}`)) out.bcSource = true;
  return out;
}

export const canadabuysSearch: Connector = {
  kind: 'canadabuys_search',

  async list(source: SourceRecord, ctx: ConnectorContext): Promise<ListResult> {
    const template = source.config.url || CANADABUYS_SEARCH_URL;
    const queries = source.config.queries.length > 0 ? source.config.queries : DEFAULT_SEARCH_QUERIES;
    const found = new Map<string, RawOpportunity>();
    let pagesRead = 0;
    let failures = 0;
    let lastError: unknown = null;

    for (const query of queries) {
      const url = template.replaceAll('{query}', encodeURIComponent(query));
      try {
        const page = await ctx.http.get(url);
        pagesRead += 1;
        for (const item of parseSearchResults(page.text, page.url, ctx.now)) {
          // Federal notices are covered by the open-data file; here we want the
          // mirrored BC Bid notices, plus anything that names a local place.
          if (!item.bcSource && !mightBeLocal(`${item.title} ${item.organization ?? ''}`, ctx.region)) continue;
          if (!found.has(item.externalId)) found.set(item.externalId, item);
        }
      } catch (error) {
        failures += 1;
        lastError = error;
        // One refused search means they will all be refused; stop asking.
        if (failures >= 2 && pagesRead === 0) throw error;
      }
    }
    if (pagesRead === 0 && lastError) throw lastError;
    ctx.note(`Searched ${pagesRead} of ${queries.length} terms${failures ? ` (${failures} failed)` : ''}; ${found.size} British Columbia notices.`);
    return { items: [...found.values()] };
  },

  async detail(_source: SourceRecord, item: RawOpportunity, ctx: ConnectorContext): Promise<Partial<RawOpportunity> | null> {
    if (!item.url) return null;
    const page = await ctx.http.get(item.url);
    return parseNotice(page.text, page.url, ctx.now);
  },
};
