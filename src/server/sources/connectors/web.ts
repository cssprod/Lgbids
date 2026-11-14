import type { SourceRecord } from '../../../shared/schemas.js';
import { extractReference } from '../../matching/notice.js';
import { findClosingDate, parseDate } from '../../util/dates.js';
import { truncate } from '../../util/text.js';
import { extractDetail, extractListing, parseFeed } from '../extract.js';
import type { Connector, ConnectorContext, ListResult, RawOpportunity } from '../types.js';

/**
 * Two general-purpose connectors that cover every site without a format of
 * its own: RSS/Atom feeds, and ordinary web pages that list opportunities.
 * Both can open each notice's own page to read the full description, the
 * closing date and the attached documents.
 */

/** Shared "open the notice page" step. */
async function readDetail(source: SourceRecord, item: RawOpportunity, ctx: ConnectorContext): Promise<Partial<RawOpportunity> | null> {
  if (!item.url) return null;
  // A link straight to a document has no page to read; keep it as a document.
  if (/\.(?:pdf|docx?|xlsx?|zip)(?:[?#]|$)/i.test(item.url)) {
    return { documents: [{ name: item.title, url: item.url }] };
  }
  const page = await ctx.http.get(item.url);
  if (!/html|xml/i.test(page.contentType) && page.contentType) {
    return /pdf/i.test(page.contentType) ? { documents: [{ name: item.title, url: item.url }] } : null;
  }
  const detail = extractDetail(page.text, page.url, { zone: source.config.timeZone, now: ctx.now });
  const out: Partial<RawOpportunity> = { description: detail.description, documents: detail.documents };
  if (detail.closing) {
    out.closing = detail.closing;
    out.closingRaw = detail.closingRaw;
  }
  if (detail.publishedAt) out.publishedAt = detail.publishedAt;
  if (detail.organization) out.organization = detail.organization;
  if (detail.referenceNumber) out.referenceNumber = detail.referenceNumber;
  if (detail.noticeTypeHint) out.noticeTypeHint = detail.noticeTypeHint;
  if (detail.location) out.location = detail.location;
  if (detail.contactName) out.contactName = detail.contactName;
  if (detail.contactEmail) out.contactEmail = detail.contactEmail;
  if (detail.contactPhone) out.contactPhone = detail.contactPhone;
  if (detail.status) out.status = detail.status;
  return out;
}

export const rss: Connector = {
  kind: 'rss',

  async list(source: SourceRecord, ctx: ConnectorContext): Promise<ListResult> {
    if (!source.config.url) throw new Error('No feed address is set for this source.');
    const response = await ctx.http.get(source.config.url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1' });
    if (!/<(?:rss|feed|rdf:RDF)[\s>]/i.test(response.text.slice(0, 3000))) {
      throw new Error('The address did not return an RSS or Atom feed.');
    }
    const feed = parseFeed(response.text, response.url);
    const zone = source.config.timeZone;
    const items: RawOpportunity[] = [];
    for (const entry of feed.items) {
      const text = `${entry.title}. ${entry.description}`.replace(/\n/g, ' ');
      const closing = findClosingDate(text, { zone, now: ctx.now });
      items.push({
        externalId: truncate(entry.id, 400),
        title: truncate(entry.title, 300),
        url: entry.link,
        organization: source.config.organization,
        referenceNumber: extractReference(entry.title),
        description: truncate(entry.description, 8000),
        publishedAt: parseDate(entry.published, { zone, now: ctx.now })?.iso ?? null,
        closing: closing ? { iso: closing.iso, precision: closing.precision } : null,
        closingRaw: closing?.text ?? '',
        categories: entry.categories,
      });
    }
    ctx.note(`${items.length} ${items.length === 1 ? 'entry' : 'entries'} in the feed.`);
    return { items };
  },

  detail: readDetail,
};

function pageUrl(base: string, param: string, page: number): string {
  const url = new URL(base);
  url.searchParams.set(param, String(page));
  return url.toString();
}

export const htmlList: Connector = {
  kind: 'html_list',

  async list(source: SourceRecord, ctx: ConnectorContext): Promise<ListResult> {
    const { config } = source;
    if (!config.url) throw new Error('No page address is set for this source.');
    const found = new Map<string, RawOpportunity>();
    const pages = config.pageParam ? config.maxPages : 1;
    let pagesRead = 0;

    for (let i = 0; i < pages; i += 1) {
      const url = config.pageParam && i > 0 ? pageUrl(config.url, config.pageParam, config.pageStart + i) : config.url;
      const response = await ctx.http.get(url);
      pagesRead += 1;
      const items = extractListing(response.text, response.url, {
        linkPattern: config.linkPattern,
        itemSelector: config.itemSelector,
        organization: config.organization,
        zone: config.timeZone,
        now: ctx.now,
      });
      let added = 0;
      for (const item of items) {
        if (found.has(item.externalId)) continue;
        found.set(item.externalId, item);
        added += 1;
      }
      // A page that adds nothing new is past the end of the listing.
      if (added === 0) break;
    }
    ctx.note(`${found.size} ${found.size === 1 ? 'notice' : 'notices'} on ${pagesRead} ${pagesRead === 1 ? 'page' : 'pages'}.`);
    return { items: [...found.values()] };
  },

  detail: readDetail,
};
