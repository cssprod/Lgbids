import {
  opportunityFilterSchema,
  sourceConfigSchema,
  type AlertKind,
  type Analysis,
  type AnalysisTrace,
  type Award,
  type AwardOrigin,
  type AwardStatus,
  type Application,
  type ApplicationChannel,
  type ApplicationFile,
  type ApplicationStatus,
  type ChecklistItem,
  type DatePrecision,
  type Decision,
  type DocumentKind,
  type DocumentLink,
  type EventRecord,
  type FeedbackReason,
  type FeedbackRecord,
  type FeedbackVerdict,
  type LibraryDocument,
  type NoticeChange,
  type NoticeChangeKind,
  type NoticeType,
  type Opportunity,
  type OpportunityStatus,
  type RunRecord,
  type RecipientChannel,
  type Recipient,
  type RunStats,
  type SavedSearch,
  type ServiceKey,
  type SourceKind,
  type SourceRecord,
  type SourceStatus,
  type SubmissionMethod,
  type UserDecision,
} from '../../shared/schemas.js';
import type {
  ApplicationCreate,
  ApplicationPatch,
  OpportunityFilter,
  OpportunityRecord,
  OpportunityView,
  ReminderRecord,
  Store,
  StoredFile,
  UpsertResult,
} from '../contracts.js';
import { organizationKey } from '../matching/geo.js';
import { extractReference, referenceKey, titleKey } from '../matching/notice.js';
import { nextLayoutHealth } from '../sources/health.js';
import type { RawOpportunity } from '../sources/types.js';
import { nowIso } from '../util/dates.js';
import { sha1 } from '../util/text.js';
import type { Database } from './database.js';

/**
 * Repositories over the SQLite schema. Columns are snake_case and JSON lists
 * are stored as text; everything leaving this module is a camelCase DTO.
 */

const HOUR = 3_600_000;
/** Two listings of the same notice on different sites close within this window. */
const DUPLICATE_WINDOW_MS = 36 * HOUR;
/** A notice with no closing date that no source has listed for this long is treated as gone. */
const UNDATED_STALE_MS = 21 * 24 * HOUR;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  enabled: number;
  builtin: number;
  notes: string;
  config: string;
  state: string;
  last_run_at: string | null;
  last_ok_at: string | null;
  last_status: string;
  last_message: string;
  last_item_count: number | null;
  consecutive_failures: number;
  layout_warning: string;
  last_ok_item_count: number | null;
  default_config: string | null;
  created_at: string;
  updated_at: string;
}

/** The columns a listing or a notice page can change. */
interface OppContent {
  title: string;
  organization: string;
  reference_number: string;
  notice_type_hint: string;
  description: string;
  url: string;
  published_at: string | null;
  closes_at: string | null;
  closes_at_precision: string | null;
  closes_at_raw: string;
  location: string;
  categories: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  documents: string;
  status: string;
}

interface OppRow extends OppContent {
  id: number;
  source_id: string;
  external_id: string;
  ref_key: string;
  title_key: string;
  duplicate_of: number | null;
  notice_type: string;
  document_text: string;
  submission_method: string;
  submission_email: string;
  submission_url: string;
  bc_source: number;
  suitability_score: number | null;
  decision: string | null;
  user_decision: string | null;
  analysis: string | null;
  content_hash: string;
  detail_fetched_at: string | null;
  documents_read_at: string | null;
  analysed_at: string | null;
  notified_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  alerts_muted: number;
  // joined
  source_name: string | null;
  app_id: number | null;
  app_status: string | null;
  unseen_changes: number | null;
  last_changed_at: string | null;
}

interface ChangeRow {
  id: number;
  opportunity_id: number;
  kind: string;
  summary: string;
  before_value: string;
  after_value: string;
  addendum: number;
  detected_at: string;
  run_id: number | null;
  notified_at: string | null;
  seen_at: string | null;
}

interface ReminderRow {
  opportunity_id: number;
  threshold_hours: number;
  closes_at: string;
  sent_at: string;
  channels: string;
}

interface FeedbackRow {
  id: number;
  opportunity_id: number | null;
  verdict: string;
  reasons: string;
  note: string;
  title: string;
  url: string;
  organization: string;
  found_via: string;
  source_id: string;
  notice_type: string;
  score: number | null;
  decision: string | null;
  matched_terms: string;
  services: string;
  area: string;
  area_match: string;
  trace: string | null;
  lexicon_version: string;
  created_at: string;
}

interface AwardRow {
  id: number;
  opportunity_id: number | null;
  notice_opportunity_id: number | null;
  org_key: string;
  ref_key: string;
  title: string;
  winner: string;
  amount: number | null;
  amount_text: string;
  awarded_on: string | null;
  url: string;
  excerpt: string;
  origin: string;
  status: string;
  notes: string;
  updated_at: string;
}

interface SavedSearchRow {
  id: number;
  name: string;
  filter: string;
  position: number;
  created_at: string;
}

interface RecipientRow {
  id: number;
  name: string;
  email: string;
  channel: string;
  chat_id_or_topic: string;
  kinds: string;
  saved_search_id: number | null;
  verified_at: string | null;
  created_at: string;
}

interface AppRow {
  id: number;
  opportunity_id: number;
  status: string;
  channel: string;
  to_email: string;
  cc_email: string;
  subject: string;
  body: string;
  price_total: number | null;
  price_notes: string;
  include_rates: number;
  checklist: string;
  document_ids: string;
  missing: string;
  auto_generated: number;
  edited_by_user: number;
  submitted_at: string | null;
  submitted_via: string;
  submission_ref: string;
  error: string;
  notes: string;
  reminded_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FileRow {
  id: number;
  application_id: number;
  name: string;
  stored_name: string;
  mime: string;
  size: number;
  created_at: string;
}

interface DocRow {
  id: number;
  name: string;
  kind: string;
  filename: string;
  stored_name: string;
  mime: string;
  size: number;
  expires_on: string;
  attach_by_default: number;
  created_at: string;
}

interface RunRow {
  id: number;
  trigger_kind: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  stats: string | null;
  error: string;
}

interface EventRow {
  id: number;
  at: string;
  level: string;
  kind: string;
  message: string;
  opportunity_id: number | null;
  application_id: number | null;
  run_id: number | null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function str(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** Store every instant in one format so that text comparison in SQL orders them correctly. */
function normIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : nowIso(date);
}

function bool(value: number | null | undefined): boolean {
  return value === 1;
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function inList(prefix: string, values: readonly unknown[]): { sql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  const names = values.map((value, i) => {
    params[`${prefix}${i}`] = value;
    return `:${prefix}${i}`;
  });
  return { sql: names.join(', '), params };
}

function cleanDocuments(docs: DocumentLink[] | undefined): DocumentLink[] {
  return (docs ?? []).filter((d) => d && typeof d.url === 'string' && d.url.trim() !== '').map((d) => ({ name: str(d.name), url: d.url.trim() }));
}

function cleanCategories(categories: string[] | undefined): string[] {
  return (categories ?? []).map((c) => str(c)).filter((c) => c !== '');
}

function contentHash(c: OppContent): string {
  return sha1([c.title, c.description, c.closes_at ?? '', c.status, c.organization, c.documents, c.categories].join('|'));
}

function keysFor(c: OppContent): { ref_key: string; title_key: string } {
  const org = organizationKey(c.organization);
  const ref = referenceKey(c.reference_number);
  const title = titleKey(c.title);
  return {
    ref_key: org && ref ? `${org}:${ref}` : '',
    title_key: org && title ? `${org}:${title}` : '',
  };
}

function pickContent(row: OppRow): OppContent {
  return {
    title: row.title,
    organization: row.organization,
    reference_number: row.reference_number,
    notice_type_hint: row.notice_type_hint,
    description: row.description,
    url: row.url,
    published_at: row.published_at,
    closes_at: row.closes_at,
    closes_at_precision: row.closes_at_precision,
    closes_at_raw: row.closes_at_raw,
    location: row.location,
    categories: row.categories,
    contact_name: row.contact_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    documents: row.documents,
    status: row.status,
  };
}

/**
 * Fill empty fields from the incoming notice. A field that already holds a
 * value is never replaced by an empty one, and only the description may be
 * replaced, by a longer one: a notice page usually carries the full text
 * where the listing had a summary.
 */
function fillFrom(target: OppContent, incoming: Partial<RawOpportunity>): void {
  const fill = (key: 'organization' | 'location' | 'contact_name' | 'contact_email' | 'contact_phone' | 'reference_number' | 'notice_type_hint', value: string | undefined) => {
    const v = str(value);
    if (v && !target[key]) target[key] = v;
  };
  fill('organization', incoming.organization);
  fill('location', incoming.location);
  fill('contact_name', incoming.contactName);
  fill('contact_email', incoming.contactEmail);
  fill('contact_phone', incoming.contactPhone);
  fill('reference_number', incoming.referenceNumber);
  fill('notice_type_hint', incoming.noticeTypeHint);

  const description = str(incoming.description);
  if (description && description.length > target.description.length) target.description = description;

  const categories = cleanCategories(incoming.categories);
  if (categories.length > 0 && parseJson<string[]>(target.categories, []).length === 0) target.categories = JSON.stringify(categories);

  const documents = cleanDocuments(incoming.documents);
  if (documents.length > 0 && parseJson<DocumentLink[]>(target.documents, []).length === 0) target.documents = JSON.stringify(documents);
}

function toSource(row: SourceRow): SourceRecord {
  const parsed = sourceConfigSchema.safeParse(parseJson<unknown>(row.config, {}));
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as SourceKind,
    enabled: bool(row.enabled),
    builtin: bool(row.builtin),
    notes: row.notes,
    config: parsed.success ? parsed.data : sourceConfigSchema.parse({}),
    lastRunAt: row.last_run_at,
    lastOkAt: row.last_ok_at,
    lastStatus: row.last_status as SourceStatus,
    lastMessage: row.last_message,
    lastItemCount: row.last_item_count,
    consecutiveFailures: row.consecutive_failures,
    layoutWarning: row.layout_warning ?? '',
  };
}

function toOpportunity(row: OppRow): Opportunity {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name || row.source_id,
    externalId: row.external_id,
    title: row.title,
    organization: row.organization,
    referenceNumber: row.reference_number,
    noticeType: row.notice_type as NoticeType,
    description: row.description,
    url: row.url,
    publishedAt: row.published_at,
    closesAt: row.closes_at,
    closesAtPrecision: (row.closes_at_precision as DatePrecision | null) ?? null,
    closesAtRaw: row.closes_at_raw,
    location: row.location,
    categories: parseJson<string[]>(row.categories, []),
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    documents: parseJson<DocumentLink[]>(row.documents, []),
    submissionMethod: row.submission_method as SubmissionMethod,
    submissionEmail: row.submission_email,
    submissionUrl: row.submission_url,
    status: row.status as OpportunityStatus,
    suitabilityScore: row.suitability_score,
    decision: (row.decision as Decision | null) ?? null,
    userDecision: (row.user_decision as UserDecision) ?? null,
    analysis: parseJson<Analysis | null>(row.analysis, null),
    duplicateOf: row.duplicate_of,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    application: row.app_id !== null ? { id: row.app_id, status: row.app_status as ApplicationStatus } : null,
    alertsMuted: bool(row.alerts_muted),
    unseenChanges: Number(row.unseen_changes ?? 0),
    lastChangedAt: row.last_changed_at ?? null,
  };
}

function toChange(row: ChangeRow): NoticeChange {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    kind: row.kind as NoticeChangeKind,
    summary: row.summary,
    before: row.before_value,
    after: row.after_value,
    addendum: bool(row.addendum),
    detectedAt: row.detected_at,
    runId: row.run_id,
    notifiedAt: row.notified_at,
    seenAt: row.seen_at,
  };
}

function toReminder(row: ReminderRow): ReminderRecord {
  return {
    opportunityId: row.opportunity_id,
    thresholdHours: row.threshold_hours,
    closesAt: row.closes_at,
    sentAt: row.sent_at,
    channels: parseJson<string[]>(row.channels, []),
  };
}

function toFeedback(row: FeedbackRow): FeedbackRecord {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    verdict: row.verdict as FeedbackVerdict,
    reasons: parseJson<FeedbackReason[]>(row.reasons, []),
    note: row.note,
    title: row.title,
    url: row.url,
    organization: row.organization,
    foundVia: row.found_via,
    sourceId: row.source_id,
    noticeType: row.notice_type as NoticeType,
    score: row.score,
    decision: (row.decision as Decision | null) ?? null,
    matchedTerms: parseJson<string[]>(row.matched_terms, []),
    services: parseJson<ServiceKey[]>(row.services, []),
    area: row.area as FeedbackRecord['area'],
    areaMatch: row.area_match,
    trace: parseJson<AnalysisTrace | null>(row.trace, null),
    lexiconVersion: row.lexicon_version,
    createdAt: row.created_at,
  };
}

function toAward(row: AwardRow): Award {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    noticeOpportunityId: row.notice_opportunity_id,
    orgKey: row.org_key,
    refKey: row.ref_key,
    title: row.title,
    winner: row.winner,
    amount: row.amount,
    amountText: row.amount_text,
    awardedOn: row.awarded_on,
    url: row.url,
    excerpt: row.excerpt,
    origin: row.origin as AwardOrigin,
    status: row.status as AwardStatus,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

function toSavedSearch(row: SavedSearchRow): SavedSearch {
  const parsed = opportunityFilterSchema.safeParse(parseJson<unknown>(row.filter, {}));
  return {
    id: row.id,
    name: row.name,
    filter: parsed.success ? parsed.data : opportunityFilterSchema.parse({}),
    position: row.position,
    createdAt: row.created_at,
  };
}

function toRecipient(row: RecipientRow): Recipient {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    channel: row.channel as RecipientChannel,
    chatIdOrTopic: row.chat_id_or_topic,
    kinds: parseJson<AlertKind[]>(row.kinds, []),
    savedSearchId: row.saved_search_id,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

/** A source config in its canonical form (schema key order and defaults), for comparing two configs. */
function canonicalConfig(value: unknown): string {
  const parsed = sourceConfigSchema.safeParse(typeof value === 'string' ? parseJson<unknown>(value, {}) : value);
  return JSON.stringify(parsed.success ? parsed.data : sourceConfigSchema.parse({}));
}

function toRecord(row: OppRow): OpportunityRecord {
  return {
    ...toOpportunity(row),
    noticeTypeHint: row.notice_type_hint,
    documentText: row.document_text,
    bcSource: bool(row.bc_source),
    detailFetchedAt: row.detail_fetched_at,
    documentsReadAt: row.documents_read_at,
    analysedAt: row.analysed_at,
    notifiedAt: row.notified_at,
  };
}

function toFile(row: FileRow): ApplicationFile & { storedName: string } {
  return { id: row.id, name: row.name, size: row.size, mime: row.mime, storedName: row.stored_name };
}

function toApplication(row: AppRow, files: ApplicationFile[]): Application {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    status: row.status as ApplicationStatus,
    channel: row.channel as ApplicationChannel,
    toEmail: row.to_email,
    ccEmail: row.cc_email,
    subject: row.subject,
    body: row.body,
    priceTotal: row.price_total,
    priceNotes: row.price_notes,
    includeRates: bool(row.include_rates),
    checklist: parseJson<ChecklistItem[]>(row.checklist, []),
    documentIds: parseJson<number[]>(row.document_ids, []),
    files,
    missing: parseJson<string[]>(row.missing, []),
    autoGenerated: bool(row.auto_generated),
    editedByUser: bool(row.edited_by_user),
    submittedAt: row.submitted_at,
    submittedVia: row.submitted_via,
    submissionRef: row.submission_ref,
    error: row.error,
    notes: row.notes,
    remindedAt: row.reminded_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDocument(row: DocRow): LibraryDocument & { storedName: string } {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as DocumentKind,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    expiresOn: row.expires_on,
    attachByDefault: bool(row.attach_by_default),
    createdAt: row.created_at,
    storedName: row.stored_name,
  };
}

/** The library document without its on-disk name, which the API never shows. */
function publicDocument(doc: LibraryDocument & { storedName: string }): LibraryDocument {
  const { storedName: _stored, ...rest } = doc;
  return rest;
}

function toRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    trigger: row.trigger_kind as RunRecord['trigger'],
    status: row.status as RunRecord['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    stats: parseJson<RunStats | null>(row.stats, null),
    error: row.error,
  };
}

function toEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    at: row.at,
    level: row.level as EventRecord['level'],
    kind: row.kind,
    message: row.message,
    opportunityId: row.opportunity_id,
    applicationId: row.application_id,
    runId: row.run_id,
  };
}

/** Silent changes (a date refined to a time) are not counted as news. */
const LOUD_CHANGE = "c.opportunity_id = o.id AND c.kind != 'closing_refined'";

const OPP_SELECT = `
  SELECT o.*, s.name AS source_name, a.id AS app_id, a.status AS app_status,
    (SELECT COUNT(*) FROM opportunity_changes c WHERE ${LOUD_CHANGE} AND c.seen_at IS NULL) AS unseen_changes,
    (SELECT MAX(c.detected_at) FROM opportunity_changes c WHERE ${LOUD_CHANGE}) AS last_changed_at
  FROM opportunities o
  LEFT JOIN sources s ON s.id = o.source_id
  LEFT JOIN applications a ON a.opportunity_id = o.id`;

const NOT_DISMISSED = "COALESCE(o.user_decision, '') != 'dismissed'";
const UNDECIDED = "COALESCE(o.user_decision, '') NOT IN ('dismissed', 'pursue')";

const VIEW_WHERE: Record<OpportunityView, string> = {
  suitable: `o.status = 'open' AND ${NOT_DISMISSED} AND (o.decision = 'suitable' OR o.user_decision = 'pursue')`,
  review: `o.status = 'open' AND ${UNDECIDED} AND o.decision = 'review'`,
  unsuitable: `o.status = 'open' AND ${UNDECIDED} AND (o.decision = 'unsuitable' OR o.decision IS NULL)`,
  closed: `o.status != 'open'`,
  dismissed: `o.user_decision = 'dismissed'`,
  all: '1 = 1',
};

const VIEWS = Object.keys(VIEW_WHERE) as OpportunityView[];

/** Application fields the patch may set, with their column and how to store them. */
const APP_PATCH_COLUMNS: Record<keyof ApplicationPatch, { column: string; json?: boolean }> = {
  status: { column: 'status' },
  channel: { column: 'channel' },
  toEmail: { column: 'to_email' },
  ccEmail: { column: 'cc_email' },
  subject: { column: 'subject' },
  body: { column: 'body' },
  priceTotal: { column: 'price_total' },
  priceNotes: { column: 'price_notes' },
  includeRates: { column: 'include_rates' },
  checklist: { column: 'checklist', json: true },
  documentIds: { column: 'document_ids', json: true },
  missing: { column: 'missing', json: true },
  editedByUser: { column: 'edited_by_user' },
  submittedAt: { column: 'submitted_at' },
  submittedVia: { column: 'submitted_via' },
  submissionRef: { column: 'submission_ref' },
  error: { column: 'error' },
  notes: { column: 'notes' },
  remindedAt: { column: 'reminded_at' },
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export function createStore(db: Database): Store {
  function oppRow(id: number): OppRow | undefined {
    return db.get<OppRow>(`${OPP_SELECT} WHERE o.id = :id`, { id });
  }

  /** Write the content columns back with fresh keys and hash. */
  function writeContent(id: number, c: OppContent, extra: { changed: boolean; closingChanged: boolean; bcSource?: boolean; now?: Date; detail?: boolean }): void {
    const keys = keysFor(c);
    db.run(
      `UPDATE opportunities SET
         title = :title, organization = :organization, reference_number = :reference_number,
         notice_type_hint = :notice_type_hint, description = :description, url = :url,
         published_at = :published_at, closes_at = :closes_at, closes_at_precision = :closes_at_precision,
         closes_at_raw = :closes_at_raw, location = :location, categories = :categories,
         contact_name = :contact_name, contact_email = :contact_email, contact_phone = :contact_phone,
         documents = :documents, status = :status,
         ref_key = :ref_key, title_key = :title_key, content_hash = :content_hash,
         bc_source = CASE WHEN :bc = 1 THEN 1 ELSE bc_source END,
         last_seen_at = COALESCE(:seen, last_seen_at),
         detail_fetched_at = CASE WHEN :detail = 1 THEN :stamp ELSE detail_fetched_at END,
         analysed_at = CASE WHEN :changed = 1 THEN NULL ELSE analysed_at END,
         notified_at = CASE WHEN :closing_changed = 1 THEN NULL ELSE notified_at END
       WHERE id = :id`,
      {
        ...c,
        ...keys,
        content_hash: contentHash(c),
        bc: extra.bcSource ?? false,
        seen: extra.now && !extra.detail ? nowIso(extra.now) : null,
        detail: extra.detail ?? false,
        stamp: extra.now ? nowIso(extra.now) : null,
        changed: extra.changed,
        closing_changed: extra.closingChanged,
        id,
      },
    );
  }

  function applicationFiles(applicationId: number): (ApplicationFile & { storedName: string })[] {
    return db.all<FileRow>('SELECT * FROM application_files WHERE application_id = :id ORDER BY id', { id: applicationId }).map(toFile);
  }

  function publicFiles(applicationId: number): ApplicationFile[] {
    return applicationFiles(applicationId).map(({ storedName: _s, ...file }) => file);
  }

  function loadApplication(row: AppRow, withOpportunity: boolean): Application {
    const app = toApplication(row, publicFiles(row.id));
    if (withOpportunity) {
      const opp = oppRow(row.opportunity_id);
      if (opp) app.opportunity = toOpportunity(opp);
    }
    return app;
  }

  function getDocumentRow(id: number): DocRow | undefined {
    return db.get<DocRow>('SELECT * FROM documents WHERE id = :id', { id });
  }

  const store: Store = {
    // ---- settings --------------------------------------------------------
    getSetting(key) {
      const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key = :key', { key });
      return row ? parseJson<unknown>(row.value, undefined) : undefined;
    },

    // Storing `undefined` removes the key, so a setting can return to its default.
    setSetting(key, value, now) {
      if (value === undefined) {
        db.run('DELETE FROM settings WHERE key = :key', { key });
        return;
      }
      db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :now)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        { key, value: JSON.stringify(value), now: nowIso(now) },
      );
    },

    // ---- sources ---------------------------------------------------------
    listSources() {
      return db.all<SourceRow>('SELECT * FROM sources ORDER BY builtin DESC, name COLLATE NOCASE, id').map(toSource);
    },

    getSource(id) {
      const row = db.get<SourceRow>('SELECT * FROM sources WHERE id = :id', { id });
      return row ? toSource(row) : undefined;
    },

    insertSource(input, now) {
      const at = nowIso(now);
      db.run(
        `INSERT INTO sources (id, name, kind, enabled, builtin, notes, config, created_at, updated_at)
         VALUES (:id, :name, :kind, :enabled, :builtin, :notes, :config, :at, :at)`,
        { id: input.id, name: input.name, kind: input.kind, enabled: input.enabled, builtin: input.builtin, notes: input.notes, config: JSON.stringify(input.config), at },
      );
      return store.getSource(input.id)!;
    },

    updateSource(id, patch, now) {
      const existing = store.getSource(id);
      if (!existing) return undefined;
      const next = {
        name: patch.name ?? existing.name,
        enabled: patch.enabled ?? existing.enabled,
        notes: patch.notes ?? existing.notes,
        config: patch.config ?? existing.config,
      };
      // A new address or pattern makes any saved ETag or paging state, and a
      // warning about the old page's layout, meaningless.
      const configChanged = patch.config !== undefined && JSON.stringify(patch.config) !== JSON.stringify(existing.config);
      db.run(
        `UPDATE sources SET name = :name, enabled = :enabled, notes = :notes, config = :config,
           state = CASE WHEN :reset = 1 THEN '{}' ELSE state END,
           layout_warning = CASE WHEN :reset = 1 THEN '' ELSE layout_warning END, updated_at = :at
         WHERE id = :id`,
        { ...next, config: JSON.stringify(next.config), reset: configChanged, at: nowIso(now), id },
      );
      return store.getSource(id);
    },

    // Its opportunities stay: they may carry applications the user already sent.
    deleteSource(id) {
      return db.run('DELETE FROM sources WHERE id = :id', { id }).changes === 1;
    },

    seedSources(defaults, now) {
      db.tx(() => {
        for (const d of defaults) {
          const at = nowIso(now);
          const config = canonicalConfig(d.config);
          const existing = db.get<SourceRow>('SELECT * FROM sources WHERE id = :id', { id: d.id });
          if (!existing) {
            db.run(
              `INSERT INTO sources (id, name, kind, enabled, builtin, notes, config, default_config, created_at, updated_at)
               VALUES (:id, :name, :kind, :enabled, 1, :notes, :config, :config, :at, :at)`,
              {
                id: d.id,
                name: d.name,
                kind: d.kind,
                // "Ships off" only sets the first state, so a source the user turned
                // on stays on across restarts; "forced off" (a site that refuses
                // automated reading) is switched off again every time.
                enabled: d.enabled === false || d.forceOff ? 0 : 1,
                notes: d.notes,
                config,
                at,
              },
            );
            continue;
          }
          // A source the user added keeps everything, even if its id matches.
          if (!bool(existing.builtin)) continue;
          const stored = canonicalConfig(existing.config);
          // Before v2 the seeded default was not saved. A row never edited through
          // the app (updated_at still equals created_at), or one that already
          // matches the new default, is taken as untouched; anything else is
          // treated as the user's own settings.
          const untouched =
            existing.default_config !== null
              ? stored === canonicalConfig(existing.default_config)
              : existing.updated_at === existing.created_at || stored === config;
          db.run(
            `UPDATE sources SET
               notes = :notes,
               enabled = CASE WHEN :forceOff = 1 THEN 0 ELSE enabled END,
               name = CASE WHEN :replace = 1 THEN :name ELSE name END,
               config = CASE WHEN :replace = 1 THEN :config ELSE config END,
               state = CASE WHEN :replace = 1 AND :moved = 1 THEN '{}' ELSE state END,
               layout_warning = CASE WHEN :replace = 1 AND :moved = 1 THEN '' ELSE layout_warning END,
               default_config = :config
             WHERE id = :id`,
            {
              id: d.id,
              notes: d.notes,
              forceOff: d.forceOff ? 1 : 0,
              replace: untouched ? 1 : 0,
              // A new address makes saved paging state and an old layout warning meaningless.
              moved: stored !== config ? 1 : 0,
              name: d.name,
              config,
            },
          );
        }
      });
    },

    // An empty listing is still a successful read, so it does not count as a failure.
    recordSourceRun(id, result, now) {
      const at = nowIso(now);
      const ok = result.status === 'ok' || result.status === 'empty';
      const before = db.get<{ layout_warning: string; last_ok_item_count: number | null }>(
        'SELECT layout_warning, last_ok_item_count FROM sources WHERE id = :id',
        { id },
      );
      const health = nextLayoutHealth({ okItemCount: before?.last_ok_item_count ?? null, warning: before?.layout_warning ?? '' }, result);
      db.run(
        `UPDATE sources SET last_run_at = :at, last_status = :status, last_message = :message,
           last_item_count = :count,
           last_ok_at = CASE WHEN :ok = 1 THEN :at ELSE last_ok_at END,
           last_ok_item_count = CASE WHEN :ok = 1 THEN :count ELSE last_ok_item_count END,
           layout_warning = :warning,
           consecutive_failures = CASE WHEN :ok = 1 THEN 0 ELSE consecutive_failures + 1 END
         WHERE id = :id`,
        { at, status: result.status, message: result.message, count: result.itemCount, ok, warning: health.warning, id },
      );
      return { layoutWarning: health.warning, raised: health.raised };
    },

    clearLayoutWarning(id) {
      db.run("UPDATE sources SET layout_warning = '' WHERE id = :id", { id });
    },

    getSourceState(id) {
      const row = db.get<{ state: string }>('SELECT state FROM sources WHERE id = :id', { id });
      const state = parseJson<unknown>(row?.state, {});
      return state && typeof state === 'object' && !Array.isArray(state) ? (state as Record<string, unknown>) : {};
    },

    setSourceState(id, state) {
      db.run('UPDATE sources SET state = :state WHERE id = :id', { state: JSON.stringify(state ?? {}), id });
    },

    clearSourceStates() {
      db.run("UPDATE sources SET state = '{}'");
    },

    // ---- opportunities ---------------------------------------------------
    upsertOpportunity(sourceId, raw, bcSource, now): UpsertResult {
      return db.tx(() => {
        const existing = db.get<OppRow>('SELECT * FROM opportunities WHERE source_id = :sourceId AND external_id = :externalId', {
          sourceId,
          externalId: raw.externalId,
        });
        const closing = raw.closing ? { iso: normIso(raw.closing.iso), precision: raw.closing.precision } : null;
        const at = nowIso(now);

        if (!existing) {
          const title = str(raw.title);
          const c: OppContent = {
            title,
            organization: '',
            reference_number: str(raw.referenceNumber) || extractReference(title),
            notice_type_hint: '',
            description: '',
            url: str(raw.url),
            published_at: normIso(raw.publishedAt),
            closes_at: closing?.iso ?? null,
            closes_at_precision: closing?.iso ? closing.precision : null,
            closes_at_raw: str(raw.closingRaw),
            location: '',
            categories: '[]',
            contact_name: '',
            contact_email: '',
            contact_phone: '',
            documents: '[]',
            status: raw.status ?? 'open',
          };
          fillFrom(c, raw);
          const result = db.run(
            `INSERT INTO opportunities (
               source_id, external_id, ref_key, title_key, title, organization, reference_number, notice_type_hint,
               description, url, published_at, closes_at, closes_at_precision, closes_at_raw, location, categories,
               contact_name, contact_email, contact_phone, documents, status, bc_source, content_hash,
               first_seen_at, last_seen_at)
             VALUES (
               :source_id, :external_id, :ref_key, :title_key, :title, :organization, :reference_number, :notice_type_hint,
               :description, :url, :published_at, :closes_at, :closes_at_precision, :closes_at_raw, :location, :categories,
               :contact_name, :contact_email, :contact_phone, :documents, :status, :bc_source, :content_hash,
               :at, :at)`,
            { ...c, ...keysFor(c), source_id: sourceId, external_id: raw.externalId, bc_source: bcSource, content_hash: contentHash(c), at },
          );
          return { id: result.lastInsertRowid, isNew: true, changed: true, closingChanged: false };
        }

        const c = pickContent(existing);
        // What the listing currently says wins for these fields, as long as it says something.
        const title = str(raw.title);
        if (title) c.title = title;
        const url = str(raw.url);
        if (url) c.url = url;
        if (raw.status) c.status = raw.status;
        const published = normIso(raw.publishedAt);
        if (published) c.published_at = published;
        if (closing?.iso) {
          // A listing that shows only the date must not undo the exact time read
          // from the notice page for that same day; that would look like a change every run.
          const sameDayCoarser =
            closing.precision === 'date' &&
            c.closes_at_precision === 'datetime' &&
            c.closes_at !== null &&
            Math.abs(Date.parse(closing.iso) - Date.parse(c.closes_at)) < 24 * HOUR;
          if (!sameDayCoarser) {
            c.closes_at = closing.iso;
            c.closes_at_precision = closing.precision;
            const rawText = str(raw.closingRaw);
            if (rawText) c.closes_at_raw = rawText;
          }
        } else if (!c.closes_at_raw && str(raw.closingRaw)) {
          c.closes_at_raw = str(raw.closingRaw);
        }
        fillFrom(c, raw);
        if (!c.reference_number) c.reference_number = extractReference(c.title);

        const closingChanged = existing.closes_at !== null && c.closes_at !== null && existing.closes_at !== c.closes_at;
        const changed = contentHash(c) !== existing.content_hash;
        writeContent(existing.id, c, { changed, closingChanged, bcSource, now });
        return { id: existing.id, isNew: false, changed, closingChanged };
      });
    },

    applyDetail(id, detail, now) {
      return db.tx(() => {
        const existing = oppRow(id);
        if (!existing) return { closingChanged: false };
        const at = nowIso(now);
        if (!detail) {
          db.run('UPDATE opportunities SET detail_fetched_at = :at WHERE id = :id', { at, id });
          return { closingChanged: false };
        }
        const c = pickContent(existing);
        if (!c.title && str(detail.title)) c.title = str(detail.title);
        if (!c.url && str(detail.url)) c.url = str(detail.url);
        if (!c.published_at) c.published_at = normIso(detail.publishedAt);
        // A notice page may report that the notice was cancelled or awarded.
        if (detail.status) c.status = detail.status;

        const closingIso = detail.closing ? normIso(detail.closing.iso) : null;
        if (detail.closing && closingIso) {
          const upgrade = detail.closing.precision === 'datetime' && c.closes_at_precision === 'date';
          if (!c.closes_at || upgrade) {
            c.closes_at = closingIso;
            c.closes_at_precision = detail.closing.precision;
            if (str(detail.closingRaw)) c.closes_at_raw = str(detail.closingRaw);
          }
        }
        if (!c.closes_at_raw && str(detail.closingRaw)) c.closes_at_raw = str(detail.closingRaw);
        fillFrom(c, detail);
        if (!c.reference_number) c.reference_number = extractReference(c.title);

        const before = pickContent(existing);
        const contentChanged = JSON.stringify(before) !== JSON.stringify(c);
        const closingChanged = existing.closes_at !== null && c.closes_at !== null && existing.closes_at !== c.closes_at;
        writeContent(id, c, { changed: contentChanged, closingChanged, now, detail: true });
        return { closingChanged };
      });
    },

    setDocumentText(id, text, now) {
      db.run('UPDATE opportunities SET document_text = :text, documents_read_at = :at, analysed_at = NULL WHERE id = :id', {
        text,
        at: nowIso(now),
        id,
      });
    },

    saveAnalysis(id, result, now) {
      db.run(
        `UPDATE opportunities SET notice_type = :notice_type, suitability_score = :score, decision = :decision,
           analysis = :analysis, submission_method = :method, submission_email = :email, submission_url = :url,
           contact_email = CASE WHEN contact_email = '' AND :contact != '' THEN :contact ELSE contact_email END,
           analysed_at = :at
         WHERE id = :id`,
        {
          notice_type: result.noticeType,
          score: Math.round(result.score),
          decision: result.decision,
          analysis: JSON.stringify(result.analysis),
          method: result.submissionMethod,
          email: result.submissionEmail,
          url: result.submissionUrl,
          contact: str(result.contactEmail),
          at: nowIso(now),
          id,
        },
      );
    },

    linkDuplicate(id) {
      return db.tx(() => {
        const row = db.get<OppRow>('SELECT * FROM opportunities WHERE id = :id', { id });
        if (!row) return null;
        if (row.duplicate_of !== null) return row.duplicate_of;
        if (!row.ref_key && !row.title_key) return null;

        const candidates = db.all<OppRow>(
          `SELECT * FROM opportunities
           WHERE id != :id AND source_id != :source AND duplicate_of IS NULL
             AND ((ref_key != '' AND ref_key = :ref) OR (title_key != '' AND title_key = :title))
           ORDER BY id`,
          { id, source: row.source_id, ref: row.ref_key, title: row.title_key },
        );
        const closeTogether = (a: string | null, b: string | null) => !a || !b || Math.abs(Date.parse(a) - Date.parse(b)) <= DUPLICATE_WINDOW_MS;
        // A matching reference number is decisive; a matching title also needs the closings to agree.
        const match =
          candidates.find((c) => row.ref_key !== '' && c.ref_key === row.ref_key) ??
          candidates.find((c) => row.title_key !== '' && c.title_key === row.title_key && closeTogether(c.closes_at, row.closes_at));
        if (!match) return null;

        const [canonical, duplicate] = match.id < row.id ? [match, row] : [row, match];
        db.run('UPDATE opportunities SET duplicate_of = :canon WHERE id = :dup', { canon: canonical.id, dup: duplicate.id });
        // Rows that pointed at the one that is no longer canonical follow it.
        db.run('UPDATE opportunities SET duplicate_of = :canon WHERE duplicate_of = :dup', { canon: canonical.id, dup: duplicate.id });

        const c = pickContent(canonical);
        if (duplicate.description.length > c.description.length) c.description = duplicate.description;
        if (!c.closes_at && duplicate.closes_at) {
          c.closes_at = duplicate.closes_at;
          c.closes_at_precision = duplicate.closes_at_precision;
          c.closes_at_raw = duplicate.closes_at_raw;
        }
        for (const key of ['contact_name', 'contact_email', 'contact_phone', 'location', 'reference_number', 'organization', 'notice_type_hint'] as const) {
          if (!c[key] && duplicate[key]) c[key] = duplicate[key];
        }
        const docs = parseJson<DocumentLink[]>(c.documents, []);
        const seen = new Set(docs.map((d) => d.url));
        for (const doc of parseJson<DocumentLink[]>(duplicate.documents, [])) {
          if (!seen.has(doc.url)) {
            docs.push(doc);
            seen.add(doc.url);
          }
        }
        c.documents = JSON.stringify(docs);
        if (parseJson<string[]>(c.categories, []).length === 0) c.categories = duplicate.categories;

        let submission = { method: canonical.submission_method, email: canonical.submission_email, url: canonical.submission_url };
        if (submission.method === 'unknown' && duplicate.submission_method !== 'unknown') submission.method = duplicate.submission_method;
        if (!submission.email && duplicate.submission_email) submission = { ...submission, email: duplicate.submission_email };
        if (!submission.url && duplicate.submission_url) submission = { ...submission, url: duplicate.submission_url };
        const submissionChanged =
          submission.method !== canonical.submission_method || submission.email !== canonical.submission_email || submission.url !== canonical.submission_url;

        const contentChanged = JSON.stringify(c) !== JSON.stringify(pickContent(canonical));
        if (contentChanged) writeContent(canonical.id, c, { changed: true, closingChanged: false, bcSource: bool(duplicate.bc_source) });
        if (submissionChanged || contentChanged) {
          db.run(
            `UPDATE opportunities SET submission_method = :method, submission_email = :email, submission_url = :url,
               bc_source = CASE WHEN :bc = 1 THEN 1 ELSE bc_source END, analysed_at = NULL
             WHERE id = :id`,
            { ...submission, bc: bool(duplicate.bc_source), id: canonical.id },
          );
        }
        return canonical.id;
      });
    },

    getOpportunity(id) {
      const row = oppRow(id);
      return row ? toRecord(row) : undefined;
    },

    listOpportunities(filter: OpportunityFilter, now) {
      const view = filter.view ?? 'all';
      const where = ['o.duplicate_of IS NULL', VIEW_WHERE[view] ?? VIEW_WHERE.all];
      const params: Record<string, unknown> = {};
      const q = str(filter.q);
      if (q) {
        where.push(
          "(o.title LIKE :q ESCAPE '\\' OR o.organization LIKE :q ESCAPE '\\' OR o.reference_number LIKE :q ESCAPE '\\' OR o.description LIKE :q ESCAPE '\\')",
        );
        params.q = `%${escapeLike(q)}%`;
      }
      if (filter.sourceId) {
        where.push('o.source_id = :sourceId');
        params.sourceId = filter.sourceId;
      }
      if (filter.closingWithinDays !== undefined) {
        // Closing times are stored as UTC ISO strings, so text order is time order.
        where.push('o.closes_at IS NOT NULL AND o.closes_at >= :closeFrom AND o.closes_at <= :closeUntil');
        params.closeFrom = nowIso(now);
        params.closeUntil = nowIso(new Date(now.getTime() + filter.closingWithinDays * 86_400_000));
      }
      if (filter.minScore !== undefined && Number.isFinite(filter.minScore)) {
        where.push('o.suitability_score IS NOT NULL AND o.suitability_score >= :minScore');
        params.minScore = Math.max(0, Math.min(100, Math.round(filter.minScore)));
      }
      if (filter.service) {
        where.push("EXISTS (SELECT 1 FROM json_each(o.analysis, '$.services') WHERE json_each.value = :service)");
        params.service = filter.service;
      }
      const place = str(filter.place);
      if (place) {
        // LIKE ignores case for ASCII letters, which covers place names here.
        where.push(
          "(COALESCE(json_extract(o.analysis, '$.areaMatch'), '') LIKE :place ESCAPE '\\' OR o.location LIKE :place ESCAPE '\\')",
        );
        params.place = `%${escapeLike(place)}%`;
      }
      const order =
        view === 'suitable' || view === 'review'
          ? 'o.closes_at IS NULL, o.closes_at ASC, o.id ASC'
          : 'o.first_seen_at DESC, o.id DESC';
      const limit = Math.min(500, Math.max(1, Math.floor(filter.limit ?? 100)));
      const offset = Math.max(0, Math.floor(filter.offset ?? 0));
      const whereSql = where.join(' AND ');
      const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM opportunities o WHERE ${whereSql}`, params)?.n ?? 0;
      const items = db
        .all<OppRow>(`${OPP_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT :limit OFFSET :offset`, { ...params, limit, offset })
        .map(toRecord);
      return { items, total };
    },

    countOpportunities(_now) {
      const sums = VIEWS.map((v) => `COALESCE(SUM(CASE WHEN ${VIEW_WHERE[v]} THEN 1 ELSE 0 END), 0) AS "${v}"`).join(', ');
      const row = db.get<Record<OpportunityView, number>>(`SELECT ${sums} FROM opportunities o WHERE o.duplicate_of IS NULL`);
      const counts = {} as Record<OpportunityView, number>;
      for (const v of VIEWS) counts[v] = Number(row?.[v] ?? 0);
      return counts;
    },

    duplicatesOf(id) {
      return db
        .all<{ source_name: string | null; source_id: string; url: string }>(
          `SELECT s.name AS source_name, o.source_id, o.url FROM opportunities o
           LEFT JOIN sources s ON s.id = o.source_id
           WHERE o.duplicate_of = :id ORDER BY o.id`,
          { id },
        )
        .map((r) => ({ sourceName: r.source_name || r.source_id, url: r.url }));
    },

    setUserDecision(id, decision) {
      db.run('UPDATE opportunities SET user_decision = :decision WHERE id = :id', { decision, id });
    },

    opportunitiesToAnalyse() {
      return db
        .all<OppRow>(`${OPP_SELECT} WHERE o.status = 'open' AND o.duplicate_of IS NULL AND o.analysed_at IS NULL ORDER BY o.id`)
        .map(toRecord);
    },

    markAllForAnalysis() {
      db.run("UPDATE opportunities SET analysed_at = NULL WHERE status = 'open' AND duplicate_of IS NULL");
    },

    closeExpired(now) {
      return db.tx(() => {
        const at = nowIso(now);
        const stale = nowIso(new Date(now.getTime() - UNDATED_STALE_MS));
        const ids = db
          .all<{ id: number }>(
            `SELECT id FROM opportunities
             WHERE status = 'open' AND ((closes_at IS NOT NULL AND closes_at <= :at) OR (closes_at IS NULL AND last_seen_at < :stale))
             ORDER BY id`,
            { at, stale },
          )
          .map((r) => r.id);
        for (const id of ids) db.run("UPDATE opportunities SET status = 'closed' WHERE id = :id", { id });
        return ids;
      });
    },

    markNotified(ids, now) {
      if (ids.length === 0) return;
      const at = nowIso(now);
      db.tx(() => {
        for (const id of ids) db.run('UPDATE opportunities SET notified_at = :at WHERE id = :id', { at, id });
      });
    },

    // ---- applications ----------------------------------------------------
    createApplication(data: ApplicationCreate, now) {
      const at = nowIso(now);
      const result = db.run(
        `INSERT INTO applications (opportunity_id, status, channel, to_email, cc_email, subject, body, include_rates,
           checklist, document_ids, missing, auto_generated, created_at, updated_at)
         VALUES (:opportunity_id, :status, :channel, :to_email, :cc_email, :subject, :body, :include_rates,
           :checklist, :document_ids, :missing, :auto_generated, :at, :at)`,
        {
          opportunity_id: data.opportunityId,
          status: data.status,
          channel: data.channel,
          to_email: data.toEmail,
          cc_email: data.ccEmail,
          subject: data.subject,
          body: data.body,
          include_rates: data.includeRates,
          checklist: JSON.stringify(data.checklist),
          document_ids: JSON.stringify(data.documentIds),
          missing: JSON.stringify(data.missing),
          auto_generated: data.autoGenerated,
          at,
        },
      );
      return store.getApplication(result.lastInsertRowid)!;
    },

    getApplication(id) {
      const row = db.get<AppRow>('SELECT * FROM applications WHERE id = :id', { id });
      return row ? loadApplication(row, true) : undefined;
    },

    getApplicationByOpportunity(opportunityId) {
      const row = db.get<AppRow>('SELECT * FROM applications WHERE opportunity_id = :id', { id: opportunityId });
      return row ? loadApplication(row, true) : undefined;
    },

    listApplications(filter) {
      const statuses = filter.status ?? [];
      if (filter.status && statuses.length === 0) return [];
      const list = inList('s', statuses);
      const where = statuses.length > 0 ? `WHERE status IN (${list.sql})` : '';
      return db
        .all<AppRow>(`SELECT * FROM applications ${where} ORDER BY created_at DESC, id DESC`, list.params)
        .map((row) => loadApplication(row, true));
    },

    updateApplication(id, patch, now) {
      const sets: string[] = [];
      const params: Record<string, unknown> = { id, updated_at: nowIso(now) };
      for (const [key, value] of Object.entries(patch) as [keyof ApplicationPatch, unknown][]) {
        const spec = APP_PATCH_COLUMNS[key];
        if (!spec || value === undefined) continue;
        sets.push(`${spec.column} = :${spec.column}`);
        params[spec.column] = spec.json ? JSON.stringify(value) : value;
      }
      sets.push('updated_at = :updated_at');
      db.run(`UPDATE applications SET ${sets.join(', ')} WHERE id = :id`, params);
      return store.getApplication(id);
    },

    transitionApplication(id, from, to, now) {
      if (from.length === 0) return false;
      const list = inList('f', from);
      const result = db.run(`UPDATE applications SET status = :to, updated_at = :at WHERE id = :id AND status IN (${list.sql})`, {
        ...list.params,
        to,
        at: nowIso(now),
        id,
      });
      return result.changes === 1;
    },

    countSubmittedSince(sinceIso, autoOnly) {
      const row = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM applications
         WHERE submitted_at IS NOT NULL AND submitted_at >= :since AND (:auto = 0 OR submitted_via = 'auto-email')`,
        { since: normIso(sinceIso) ?? sinceIso, auto: autoOnly },
      );
      return row?.n ?? 0;
    },

    addApplicationFile(applicationId, file: StoredFile, now) {
      const result = db.run(
        `INSERT INTO application_files (application_id, name, stored_name, mime, size, created_at)
         VALUES (:application_id, :name, :stored_name, :mime, :size, :at)`,
        { application_id: applicationId, name: file.name, stored_name: file.storedName, mime: file.mime, size: file.size, at: nowIso(now) },
      );
      return { id: result.lastInsertRowid, name: file.name, size: file.size, mime: file.mime };
    },

    getApplicationFile(applicationId, fileId) {
      const row = db.get<FileRow>('SELECT * FROM application_files WHERE id = :fileId AND application_id = :applicationId', {
        fileId,
        applicationId,
      });
      return row ? toFile(row) : undefined;
    },

    listApplicationFiles(applicationId) {
      return applicationFiles(applicationId);
    },

    deleteApplicationFile(applicationId, fileId) {
      const file = store.getApplicationFile(applicationId, fileId);
      if (!file) return null;
      db.run('DELETE FROM application_files WHERE id = :id', { id: fileId });
      return file.storedName;
    },

    // ---- document library ------------------------------------------------
    addDocument(doc, now) {
      const result = db.run(
        `INSERT INTO documents (name, kind, filename, stored_name, mime, size, expires_on, attach_by_default, created_at)
         VALUES (:name, :kind, :filename, :stored_name, :mime, :size, :expires_on, :attach, :at)`,
        {
          name: doc.name,
          kind: doc.kind,
          filename: doc.filename,
          stored_name: doc.storedName,
          mime: doc.mime,
          size: doc.size,
          expires_on: doc.expiresOn,
          attach: doc.attachByDefault,
          at: nowIso(now),
        },
      );
      return publicDocument(toDocument(getDocumentRow(result.lastInsertRowid)!));
    },

    listDocuments() {
      return db.all<DocRow>('SELECT * FROM documents ORDER BY id DESC').map((row) => publicDocument(toDocument(row)));
    },

    getDocument(id) {
      const row = getDocumentRow(id);
      return row ? toDocument(row) : undefined;
    },

    updateDocument(id, patch) {
      const row = getDocumentRow(id);
      if (!row) return undefined;
      db.run('UPDATE documents SET name = :name, kind = :kind, expires_on = :expires_on, attach_by_default = :attach WHERE id = :id', {
        name: patch.name ?? row.name,
        kind: patch.kind ?? row.kind,
        expires_on: patch.expiresOn ?? row.expires_on,
        attach: patch.attachByDefault ?? bool(row.attach_by_default),
        id,
      });
      return publicDocument(toDocument(getDocumentRow(id)!));
    },

    deleteDocument(id) {
      return db.tx(() => {
        const row = getDocumentRow(id);
        if (!row) return null;
        db.run('DELETE FROM documents WHERE id = :id', { id });
        // Applications must not keep pointing at a file that is gone, or sending would fail.
        const apps = db.all<{ id: number; document_ids: string }>("SELECT id, document_ids FROM applications WHERE document_ids != '[]'");
        for (const app of apps) {
          const ids = parseJson<number[]>(app.document_ids, []);
          if (!ids.includes(id)) continue;
          db.run('UPDATE applications SET document_ids = :ids WHERE id = :app', { ids: JSON.stringify(ids.filter((d) => d !== id)), app: app.id });
        }
        return row.stored_name;
      });
    },

    // ---- runs & events ---------------------------------------------------
    startRun(trigger, now) {
      const result = db.run("INSERT INTO runs (trigger_kind, status, started_at) VALUES (:trigger, 'running', :at)", { trigger, at: nowIso(now) });
      return toRun(db.get<RunRow>('SELECT * FROM runs WHERE id = :id', { id: result.lastInsertRowid })!);
    },

    finishRun(id, status, stats, error, now) {
      db.run('UPDATE runs SET status = :status, stats = :stats, error = :error, finished_at = :at WHERE id = :id', {
        status,
        stats: stats ? JSON.stringify(stats) : null,
        error,
        at: nowIso(now),
        id,
      });
      return toRun(db.get<RunRow>('SELECT * FROM runs WHERE id = :id', { id })!);
    },

    failStaleRuns(now) {
      db.run(
        "UPDATE runs SET status = 'error', error = 'The app stopped while this run was in progress.', finished_at = :at WHERE status = 'running'",
        { at: nowIso(now) },
      );
    },

    latestRun() {
      const row = db.get<RunRow>('SELECT * FROM runs ORDER BY id DESC LIMIT 1');
      return row ? toRun(row) : undefined;
    },

    listRuns(limit) {
      return db.all<RunRow>('SELECT * FROM runs ORDER BY id DESC LIMIT :limit', { limit: Math.max(1, Math.floor(limit)) }).map(toRun);
    },

    addEvent(event, now) {
      db.run(
        `INSERT INTO events (at, level, kind, message, opportunity_id, application_id, run_id)
         VALUES (:at, :level, :kind, :message, :opportunity_id, :application_id, :run_id)`,
        {
          at: nowIso(now),
          level: event.level,
          kind: event.kind,
          message: event.message,
          opportunity_id: event.opportunityId ?? null,
          application_id: event.applicationId ?? null,
          run_id: event.runId ?? null,
        },
      );
    },

    listEvents(limit) {
      return db.all<EventRow>('SELECT * FROM events ORDER BY id DESC LIMIT :limit', { limit: Math.max(1, Math.floor(limit)) }).map(toEvent);
    },

    pruneHistory(beforeIso) {
      const events = db.run('DELETE FROM events WHERE at < :before', { before: beforeIso }).changes;
      const runs = db.run("DELETE FROM runs WHERE status != 'running' AND started_at < :before", { before: beforeIso }).changes;
      return { events, runs };
    },

    // ---- sessions --------------------------------------------------------
    createSession(token, expiresAt, now) {
      const at = nowIso(now);
      db.tx(() => {
        // Tidy up on each sign-in so the table never grows without bound.
        db.run('DELETE FROM sessions WHERE expires_at <= :at', { at });
        db.run('INSERT INTO sessions (token, created_at, expires_at) VALUES (:token, :at, :expires)', { token, at, expires: nowIso(expiresAt) });
      });
    },

    sessionValid(token, now) {
      if (!token) return false;
      return db.get<{ token: string }>('SELECT token FROM sessions WHERE token = :token AND expires_at > :at', { token, at: nowIso(now) }) !== undefined;
    },

    deleteSession(token) {
      db.run('DELETE FROM sessions WHERE token = :token', { token });
    },

    deleteAllSessions() {
      return db.run('DELETE FROM sessions').changes;
    },

    // ---- v2: watching bids and their changes ------------------------------
    setAlertsMuted(opportunityId, muted) {
      return db.run('UPDATE opportunities SET alerts_muted = :muted WHERE id = :id', { muted, id: opportunityId }).changes === 1;
    },

    addChange(change) {
      const { lastInsertRowid } = db.run(
        `INSERT INTO opportunity_changes (opportunity_id, kind, summary, before_value, after_value, addendum, detected_at, run_id)
         VALUES (:opportunityId, :kind, :summary, :before, :after, :addendum, :detectedAt, :runId)`,
        { ...change, runId: change.runId ?? null },
      );
      return toChange(db.get<ChangeRow>('SELECT * FROM opportunity_changes WHERE id = :id', { id: lastInsertRowid })!);
    },

    listChanges(opportunityId) {
      return db
        .all<ChangeRow>('SELECT * FROM opportunity_changes WHERE opportunity_id = :id ORDER BY detected_at DESC, id DESC', { id: opportunityId })
        .map(toChange);
    },

    unnotifiedChanges() {
      return db.all<ChangeRow>('SELECT * FROM opportunity_changes WHERE notified_at IS NULL ORDER BY detected_at, id').map(toChange);
    },

    markChangesNotified(ids, now) {
      if (ids.length === 0) return;
      const list = inList('c', ids);
      db.run(`UPDATE opportunity_changes SET notified_at = :at WHERE id IN (${list.sql})`, { ...list.params, at: nowIso(now) });
    },

    markChangesSeen(opportunityId, now) {
      return db.run('UPDATE opportunity_changes SET seen_at = :at WHERE opportunity_id = :id AND seen_at IS NULL', { at: nowIso(now), id: opportunityId })
        .changes;
    },

    countUnseenChanges() {
      return (
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM opportunity_changes c JOIN opportunities o ON o.id = c.opportunity_id
           WHERE o.duplicate_of IS NULL AND ${LOUD_CHANGE} AND c.seen_at IS NULL`,
        )?.n ?? 0
      );
    },

    // ---- v2: closing reminders -------------------------------------------
    reminderSent(opportunityId, thresholdHours, closesAt) {
      return (
        db.get<{ n: number }>(
          'SELECT 1 AS n FROM reminders_sent WHERE opportunity_id = :id AND threshold_hours = :h AND closes_at = :closes',
          { id: opportunityId, h: thresholdHours, closes: closesAt },
        ) !== undefined
      );
    },

    recordReminder(r) {
      db.run(
        `INSERT INTO reminders_sent (opportunity_id, threshold_hours, closes_at, sent_at, channels)
         VALUES (:id, :h, :closes, :sent, :channels)
         ON CONFLICT (opportunity_id, threshold_hours, closes_at) DO UPDATE SET sent_at = excluded.sent_at, channels = excluded.channels`,
        { id: r.opportunityId, h: r.thresholdHours, closes: r.closesAt, sent: r.sentAt, channels: JSON.stringify(r.channels) },
      );
    },

    listReminders(opportunityId) {
      return db
        .all<ReminderRow>('SELECT * FROM reminders_sent WHERE opportunity_id = :id ORDER BY sent_at, threshold_hours DESC', { id: opportunityId })
        .map(toReminder);
    },

    // ---- v2: feedback ----------------------------------------------------
    saveFeedback(f, now) {
      const params = {
        opportunityId: f.opportunityId,
        verdict: f.verdict,
        reasons: JSON.stringify(f.reasons),
        note: f.note,
        title: f.title,
        url: f.url,
        organization: f.organization,
        foundVia: f.foundVia,
        sourceId: f.sourceId,
        noticeType: f.noticeType,
        score: f.score,
        decision: f.decision,
        matchedTerms: JSON.stringify(f.matchedTerms),
        services: JSON.stringify(f.services),
        area: f.area,
        areaMatch: f.areaMatch,
        trace: f.trace ? JSON.stringify(f.trace) : null,
        lexiconVersion: f.lexiconVersion,
        at: nowIso(now),
      };
      return db.tx(() => {
        // One record per opportunity: saving again replaces it.
        if (f.opportunityId !== null) db.run('DELETE FROM feedback WHERE opportunity_id = :opportunityId', { opportunityId: f.opportunityId });
        const { lastInsertRowid } = db.run(
          `INSERT INTO feedback (opportunity_id, verdict, reasons, note, title, url, organization, found_via, source_id, notice_type,
             score, decision, matched_terms, services, area, area_match, trace, lexicon_version, created_at)
           VALUES (:opportunityId, :verdict, :reasons, :note, :title, :url, :organization, :foundVia, :sourceId, :noticeType,
             :score, :decision, :matchedTerms, :services, :area, :areaMatch, :trace, :lexiconVersion, :at)`,
          params,
        );
        return store.getFeedback(lastInsertRowid)!;
      });
    },

    getFeedback(id) {
      const row = db.get<FeedbackRow>('SELECT * FROM feedback WHERE id = :id', { id });
      return row ? toFeedback(row) : undefined;
    },

    getFeedbackFor(opportunityId) {
      const row = db.get<FeedbackRow>('SELECT * FROM feedback WHERE opportunity_id = :id', { id: opportunityId });
      return row ? toFeedback(row) : undefined;
    },

    deleteFeedbackFor(opportunityId) {
      return db.run('DELETE FROM feedback WHERE opportunity_id = :id', { id: opportunityId }).changes > 0;
    },

    listFeedback(filter = {}) {
      const where = filter.sinceIso ? 'WHERE created_at >= :since' : '';
      return db
        .all<FeedbackRow>(`SELECT * FROM feedback ${where} ORDER BY created_at DESC, id DESC`, filter.sinceIso ? { since: filter.sinceIso } : undefined)
        .map(toFeedback);
    },

    // ---- v2: awards ------------------------------------------------------
    saveAward(a, now) {
      const params = {
        opportunityId: a.opportunityId,
        noticeOpportunityId: a.noticeOpportunityId,
        orgKey: a.orgKey,
        refKey: a.refKey,
        title: a.title,
        winner: a.winner,
        amount: a.amount,
        amountText: a.amountText,
        awardedOn: a.awardedOn,
        url: a.url,
        excerpt: a.excerpt,
        origin: a.origin,
        status: a.status,
        notes: a.notes,
        at: nowIso(now),
      };
      return db.tx(() => {
        if (a.opportunityId !== null) db.run('DELETE FROM awards WHERE opportunity_id = :opportunityId', { opportunityId: a.opportunityId });
        const { lastInsertRowid } = db.run(
          `INSERT INTO awards (opportunity_id, notice_opportunity_id, org_key, ref_key, title, winner, amount, amount_text, awarded_on,
             url, excerpt, origin, status, notes, updated_at)
           VALUES (:opportunityId, :noticeOpportunityId, :orgKey, :refKey, :title, :winner, :amount, :amountText, :awardedOn,
             :url, :excerpt, :origin, :status, :notes, :at)`,
          params,
        );
        return toAward(db.get<AwardRow>('SELECT * FROM awards WHERE id = :id', { id: lastInsertRowid })!);
      });
    },

    getAwardFor(opportunityId) {
      const row = db.get<AwardRow>('SELECT * FROM awards WHERE opportunity_id = :id', { id: opportunityId });
      return row ? toAward(row) : undefined;
    },

    deleteAwardFor(opportunityId) {
      return db.run('DELETE FROM awards WHERE opportunity_id = :id', { id: opportunityId }).changes > 0;
    },

    listAwards() {
      return db.all<AwardRow>('SELECT * FROM awards ORDER BY updated_at DESC, id DESC').map(toAward);
    },

    // ---- v2: saved searches ----------------------------------------------
    listSavedSearches() {
      return db.all<SavedSearchRow>('SELECT * FROM saved_searches ORDER BY position, id').map(toSavedSearch);
    },

    getSavedSearch(id) {
      const row = db.get<SavedSearchRow>('SELECT * FROM saved_searches WHERE id = :id', { id });
      return row ? toSavedSearch(row) : undefined;
    },

    createSavedSearch(input, now) {
      const name = input.name.trim();
      if (db.get('SELECT id FROM saved_searches WHERE name = :name', { name })) return null;
      const position = (db.get<{ n: number | null }>('SELECT MAX(position) AS n FROM saved_searches')?.n ?? -1) + 1;
      const filter = opportunityFilterSchema.parse(input.filter ?? {});
      const { lastInsertRowid } = db.run(
        'INSERT INTO saved_searches (name, filter, position, created_at) VALUES (:name, :filter, :position, :at)',
        { name, filter: JSON.stringify(filter), position, at: nowIso(now) },
      );
      return store.getSavedSearch(lastInsertRowid)!;
    },

    updateSavedSearch(id, patch) {
      const existing = store.getSavedSearch(id);
      if (!existing) return undefined;
      const name = patch.name?.trim() ?? existing.name;
      if (db.get('SELECT id FROM saved_searches WHERE name = :name AND id != :id', { name, id })) return null;
      db.run('UPDATE saved_searches SET name = :name, filter = :filter, position = :position WHERE id = :id', {
        name,
        filter: JSON.stringify(patch.filter ? opportunityFilterSchema.parse(patch.filter) : existing.filter),
        position: patch.position ?? existing.position,
        id,
      });
      return store.getSavedSearch(id);
    },

    deleteSavedSearch(id) {
      return db.run('DELETE FROM saved_searches WHERE id = :id', { id }).changes === 1;
    },

    // ---- v2: alert recipients --------------------------------------------
    listRecipients() {
      return db.all<RecipientRow>('SELECT * FROM recipients ORDER BY id').map(toRecipient);
    },

    getRecipient(id) {
      const row = db.get<RecipientRow>('SELECT * FROM recipients WHERE id = :id', { id });
      return row ? toRecipient(row) : undefined;
    },

    createRecipient(input, now) {
      const { lastInsertRowid } = db.run(
        `INSERT INTO recipients (name, email, channel, chat_id_or_topic, kinds, saved_search_id, created_at)
         VALUES (:name, :email, :channel, :chat, :kinds, :search, :at)`,
        {
          name: input.name,
          email: input.email,
          channel: input.channel,
          chat: input.chatIdOrTopic,
          kinds: JSON.stringify(input.kinds),
          search: input.savedSearchId,
          at: nowIso(now),
        },
      );
      return store.getRecipient(lastInsertRowid)!;
    },

    updateRecipient(id, patch) {
      const existing = store.getRecipient(id);
      if (!existing) return undefined;
      const next = { ...existing, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Recipient;
      // A new address or channel has not been tested yet.
      const moved = next.channel !== existing.channel || next.chatIdOrTopic !== existing.chatIdOrTopic || next.email !== existing.email;
      db.run(
        `UPDATE recipients SET name = :name, email = :email, channel = :channel, chat_id_or_topic = :chat, kinds = :kinds,
           saved_search_id = :search, verified_at = CASE WHEN :moved = 1 THEN NULL ELSE verified_at END
         WHERE id = :id`,
        {
          name: next.name,
          email: next.email,
          channel: next.channel,
          chat: next.chatIdOrTopic,
          kinds: JSON.stringify(next.kinds),
          search: next.savedSearchId,
          moved,
          id,
        },
      );
      return store.getRecipient(id);
    },

    deleteRecipient(id) {
      return db.run('DELETE FROM recipients WHERE id = :id', { id }).changes === 1;
    },

    markRecipientVerified(id, now) {
      db.run('UPDATE recipients SET verified_at = :at WHERE id = :id', { at: nowIso(now), id });
    },

    // ---- v2: meta --------------------------------------------------------
    getMeta(key) {
      return db.get<{ value: string }>('SELECT value FROM meta WHERE key = :key', { key })?.value;
    },

    setMeta(key, value) {
      db.run('INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value', { key, value });
    },

    close() {
      db.close();
    },
  };

  return store;
}
