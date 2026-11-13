import type { OpportunityStatus, SourceRecord } from '../../../shared/schemas.js';
import { parseDate } from '../../util/dates.js';
import { collapse, tidyParagraphs, truncate } from '../../util/text.js';
import type { Connector, ConnectorContext, ListResult, RawOpportunity } from '../types.js';

/**
 * Bonfire (now Euna Procurement) portals. The City of Victoria, District of
 * Saanich, Central Saanich, North Saanich and the University of Victoria all
 * run their bids through a Bonfire portal at <name>.bonfirehub.ca.
 *
 * Every portal answers the same public JSON request that its own "Open
 * Opportunities" page makes, with no login. It is not a documented API, so
 * the reader below is deliberately tolerant about field names and shapes.
 *
 * Submitting a bid on Bonfire needs the vendor's own login and a per-bid set
 * of uploads, so this connector only discovers; it never signs in.
 */

const LIST_PATH = '/PublicPortal/getOpenPublicOpportunitiesSectionData';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Case-insensitive property read, trying several possible names. */
function read(obj: Json, ...names: string[]): string {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const name of names) {
    const key = lower.get(name.toLowerCase());
    if (!key) continue;
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function looksLikeProject(value: unknown): value is Json {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).map((k) => k.toLowerCase());
  const hasName = keys.some((k) => k === 'projectname' || k === 'name' || k === 'title');
  const hasId = keys.some((k) => k === 'projectid' || k === 'id' || k === 'referenceid');
  return hasName && hasId;
}

/** Find the list of projects wherever it sits in the response. */
export function findProjects(payload: unknown, depth = 0): Json[] {
  if (depth > 4 || payload === null || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) {
    const projects = payload.filter(looksLikeProject);
    if (projects.length > 0) return projects;
    for (const entry of payload) {
      const nested = findProjects(entry, depth + 1);
      if (nested.length > 0) return nested;
    }
    return [];
  }
  const obj = payload as Json;
  const values = Object.values(obj);
  // An object keyed by project id: { "1234": {ProjectID: "1234", ...}, ... }
  const direct = values.filter(looksLikeProject);
  if (direct.length > 0 && direct.length >= values.length / 2) return direct;
  for (const key of ['payload', 'projects', 'data', 'opportunities', 'results', 'items']) {
    const match = Object.keys(obj).find((k) => k.toLowerCase() === key);
    if (match) {
      const nested = findProjects(obj[match], depth + 1);
      if (nested.length > 0) return nested;
    }
  }
  for (const value of values) {
    const nested = findProjects(value, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

/**
 * Bonfire timestamps look like "2026-07-09 21:00:00" with no zone. The portal
 * stores them in UTC and converts in the browser; reading them as UTC is also
 * the cautious choice, since it can only show a deadline early, never late.
 */
function bonfireDate(value: string, now: Date): { iso: string; precision: 'datetime' | 'date' } | null {
  if (!value) return null;
  return parseDate(value, { zone: 'UTC', now });
}

function statusFrom(text: string): OpportunityStatus | undefined {
  const t = text.toLowerCase();
  if (!t) return undefined;
  if (/cancel/.test(t)) return 'cancelled';
  if (/award/.test(t)) return 'awarded';
  if (/closed|evaluat|complete/.test(t)) return 'closed';
  if (/open|active|publish/.test(t)) return 'open';
  return undefined;
}

export function projectToOpportunity(project: Json, base: string, organization: string, now: Date): RawOpportunity | null {
  const id = read(project, 'ProjectID', 'projectId', 'id');
  const title = collapse(read(project, 'ProjectName', 'projectName', 'name', 'title'));
  if (!id || !title) return null;
  const closingRaw = read(project, 'DateClose', 'dateClose', 'closeDate', 'closingDate', 'DateClosed');
  const description = tidyParagraphs(read(project, 'ProjectDescription', 'Description', 'description', 'Summary').replace(/<[^>]+>/g, ' '));
  const department = collapse(read(project, 'DepartmentName', 'Department', 'department'));
  return {
    externalId: id,
    title: truncate(title, 300),
    url: `${base}/opportunities/${encodeURIComponent(id)}`,
    organization: collapse(read(project, 'OrganizationName', 'organizationName', 'Organization')) || organization,
    referenceNumber: collapse(read(project, 'ReferenceID', 'referenceId', 'ReferenceNumber', 'referenceNumber', 'ref')),
    noticeTypeHint: collapse(read(project, 'ProjectType', 'projectType', 'Type', 'type')),
    description: truncate(description, 8000),
    publishedAt: bonfireDate(read(project, 'DateOpen', 'dateOpen', 'DatePublished', 'datePublished', 'DateIssued', 'openDate'), now)?.iso ?? null,
    closing: bonfireDate(closingRaw, now),
    closingRaw: closingRaw ? `${closingRaw} UTC` : '',
    categories: department ? [department] : [],
    status: statusFrom(read(project, 'ProjectStatus', 'Status', 'status')) ?? 'open',
    bcSource: true,
  };
}

export function portalBase(url: string): string {
  const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  return u.origin;
}

export const bonfire: Connector = {
  kind: 'bonfire',

  async list(source: SourceRecord, ctx: ConnectorContext): Promise<ListResult> {
    if (!source.config.url) throw new Error('No portal address is set for this source.');
    const base = portalBase(source.config.url);
    const response = await ctx.http.get(`${base}${LIST_PATH}`, {
      accept: 'application/json, text/javascript, */*;q=0.1',
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${base}/portal/?tab=openOpportunities` },
    });
    let payload: unknown;
    try {
      payload = JSON.parse(response.text);
    } catch {
      throw new Error('The portal did not answer with JSON — its public listing may have moved or now needs a login.');
    }
    if (isObject(payload) && 'success' in payload && !payload.success && payload.success !== undefined) {
      const message = typeof payload.message === 'string' && payload.message ? payload.message : 'no reason given';
      throw new Error(`The portal refused the listing request (${message}).`);
    }
    const projects = findProjects(payload);
    const organization = source.config.organization || source.name;
    const items: RawOpportunity[] = [];
    for (const project of projects) {
      const item = projectToOpportunity(project, base, organization, ctx.now);
      if (item) items.push(item);
    }
    ctx.note(`${items.length} open ${items.length === 1 ? 'opportunity' : 'opportunities'} on the portal.`);
    return { items };
  },
};
