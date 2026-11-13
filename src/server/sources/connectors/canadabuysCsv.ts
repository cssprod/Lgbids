import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { parse } from 'csv-parse';
import type { DocumentLink, OpportunityStatus, SourceRecord } from '../../../shared/schemas.js';
import { mightBeLocal } from '../../matching/geo.js';
import { mightBeRelevant } from '../../matching/relevance.js';
import { parseDate } from '../../util/dates.js';
import { collapse, tidyParagraphs, truncate } from '../../util/text.js';
import type { Connector, ConnectorContext, ListResult, RawOpportunity } from '../types.js';

/**
 * CanadaBuys open data: the Government of Canada publishes every open federal
 * tender notice as one CSV file, refreshed daily, under the Open Government
 * Licence – Canada. This is the cleanest source there is: no scraping.
 *
 * Federal landscaping work in Greater Victoria is mostly National Defence
 * (CFB Esquimalt), Parks Canada, Fisheries and Oceans and federal buildings.
 *
 * Column names are bilingual ("title-titre-eng"). They are looked up by their
 * English stem so that a renamed French half does not break the import.
 */

export const CANADABUYS_OPEN_CSV = 'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv';

type Row = Record<string, string>;

/** Build a lookup from "stem" or "stem:eng" to the real column name. */
export function indexColumns(columns: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const column of columns) {
    const parts = column.trim().split('-');
    const stem = parts[0]!.trim().toLowerCase();
    const last = parts[parts.length - 1]!.trim().toLowerCase();
    const lang = last === 'eng' || last === 'fra' ? last : '';
    if (!stem) continue;
    if (lang) {
      if (!index.has(`${stem}:${lang}`)) index.set(`${stem}:${lang}`, column);
      if (lang === 'eng' && !index.has(stem)) index.set(stem, column);
    } else if (!index.has(stem)) {
      index.set(stem, column);
    }
  }
  return index;
}

function field(row: Row, index: Map<string, string>, ...stems: string[]): string {
  for (const stem of stems) {
    const column = index.get(stem.toLowerCase()) ?? index.get(`${stem.toLowerCase()}:eng`);
    if (!column) continue;
    const value = row[column];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function statusFrom(text: string): OpportunityStatus {
  const t = text.toLowerCase();
  if (/cancel|annul/.test(t)) return 'cancelled';
  if (/award|attribu/.test(t)) return 'awarded';
  if (/expired|closed|ferm|expir/.test(t)) return 'closed';
  return 'open';
}

function splitList(value: string): string[] {
  return value
    .split(/\s*(?:\n|\*|;|\|)\s*/)
    .map((s) => collapse(s))
    .filter(Boolean);
}

export function rowToOpportunity(row: Row, index: Map<string, string>, now: Date): RawOpportunity | null {
  const title = collapse(field(row, index, 'title'));
  const reference = field(row, index, 'referenceNumber');
  const solicitation = field(row, index, 'solicitationNumber');
  const noticeUrl = field(row, index, 'noticeURL');
  const externalId = reference || solicitation || noticeUrl;
  if (!title || !externalId) return null;

  const description = tidyParagraphs(field(row, index, 'tenderDescription'));
  const regionsDelivery = splitList(field(row, index, 'regionsOfDelivery'));
  const regionsOpportunity = splitList(field(row, index, 'regionsOfOpportunity'));
  const endUser = collapse(field(row, index, 'endUserEntitiesName'));
  const endUserAddress = collapse(field(row, index, 'endUserEntitiesAddress'));
  const contracting = collapse(field(row, index, 'contractingEntityName'));
  const contractingCity = collapse(field(row, index, 'contractingEntityAddressCity'));
  const contractingProvince = collapse(field(row, index, 'contractingEntityAddressProvince'));

  const unspsc = splitList(field(row, index, 'unspsc'));
  const unspscText = splitList(field(row, index, 'unspscDescription'));
  const gsin = splitList(field(row, index, 'gsin'));
  const gsinText = splitList(field(row, index, 'gsinDescription'));
  const categories = [
    ...unspsc.map((code, i) => `UNSPSC ${code}${unspscText[i] ? ` ${unspscText[i]}` : ''}`),
    ...gsin.map((code, i) => `GSIN ${code}${gsinText[i] ? ` ${gsinText[i]}` : ''}`),
    field(row, index, 'procurementCategory'),
  ]
    .map((c) => collapse(c))
    .filter(Boolean);

  // The file does not state a zone for closing times. CanadaBuys displays
  // Eastern time; reading zone-less values as Eastern is also the cautious
  // choice for a Pacific bidder (a deadline shown early, never late).
  const closingRaw = field(row, index, 'tenderClosingDate');
  const closing = parseDate(closingRaw, { zone: 'America/Toronto', now });
  const published = parseDate(field(row, index, 'publicationDate'), { zone: 'America/Toronto', now });

  const attachments: DocumentLink[] = splitList(field(row, index, 'attachment').replace(/,\s*(?=https?:)/g, '\n'))
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 20)
    .map((u) => ({ name: decodeURIComponent(u.split('/').pop() ?? 'Attachment').slice(0, 160), url: u }));

  const location = [...new Set([...regionsDelivery, endUserAddress].filter(Boolean))].join('; ');
  const everything = `${regionsDelivery.join(' ')} ${regionsOpportunity.join(' ')} ${contractingProvince} ${endUserAddress}`;

  return {
    externalId,
    title: truncate(title, 300),
    url: noticeUrl || `https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${encodeURIComponent(reference.toLowerCase())}`,
    organization: endUser || contracting,
    referenceNumber: solicitation,
    noticeTypeHint: collapse(`${field(row, index, 'noticeType')} ${field(row, index, 'procurementMethod')}`),
    description: truncate(description, 15000),
    publishedAt: published?.iso ?? null,
    closing,
    closingRaw,
    location: truncate(location || [contractingCity, contractingProvince].filter(Boolean).join(', '), 300),
    categories,
    contactName: collapse(field(row, index, 'contactInfoName')),
    contactEmail: collapse(field(row, index, 'contactInfoEmail')).toLowerCase(),
    contactPhone: collapse(field(row, index, 'contactInfoPhone')),
    documents: attachments,
    status: statusFrom(field(row, index, 'tenderStatus')),
    bcSource: /british columbia|colombie-britannique/i.test(everything),
  };
}

export const canadabuysCsv: Connector = {
  kind: 'canadabuys_csv',

  async list(source: SourceRecord, ctx: ConnectorContext): Promise<ListResult> {
    const url = source.config.url || CANADABUYS_OPEN_CSV;
    const headers: Record<string, string> = {};
    if (typeof ctx.state.etag === 'string') headers['if-none-match'] = ctx.state.etag;
    if (typeof ctx.state.lastModified === 'string') headers['if-modified-since'] = ctx.state.lastModified;

    const { response } = await ctx.http.stream(url, { accept: 'text/csv,*/*', headers, allowStatus: [304] });
    if (response.status === 304) {
      await response.body?.cancel().catch(() => undefined);
      ctx.note('The file has not changed since the last run.');
      return { items: [], unchanged: true };
    }
    if (!response.body) return { items: [] };

    const parser = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>).pipe(
      parse({ bom: true, columns: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true, trim: false }),
    );

    const items: RawOpportunity[] = [];
    let index: Map<string, string> | null = null;
    let rows = 0;
    for await (const record of parser as AsyncIterable<Row>) {
      rows += 1;
      if (!index) index = indexColumns(Object.keys(record));
      const item = rowToOpportunity(record, index, ctx.now);
      if (!item) continue;
      // Thousands of federal notices are open at any time; keep only those that
      // could be both in the service area and landscaping-related.
      const where = `${item.title} ${item.location} ${item.organization} ${(item.description ?? '').slice(0, 3000)}`;
      if (!mightBeLocal(where, ctx.region)) continue;
      if (!mightBeRelevant(`${item.title} ${(item.categories ?? []).join(' ')} ${item.description ?? ''}`)) continue;
      items.push(item);
    }
    if (rows > 0 && index && !index.has('title')) {
      throw new Error('The CSV file no longer has a "title" column — its format has changed.');
    }
    ctx.note(`Read ${rows.toLocaleString('en-CA')} federal notices; ${items.length} could be local landscaping work.`);

    const state: Record<string, unknown> = {};
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    if (etag) state.etag = etag;
    if (lastModified) state.lastModified = lastModified;
    return { items, state };
  },
};
