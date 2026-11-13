import type {
  DatePrecision,
  DocumentLink,
  OpportunityStatus,
  RegionSettings,
  SourceKind,
  SourceRecord,
  SourceStatus,
} from '../../shared/schemas.js';
import type { HttpClient } from '../http/client.js';

/** One notice as a source lists it, before any scoring. */
export interface RawOpportunity {
  /** Stable identifier within the source (a notice id, or the notice URL path). */
  externalId: string;
  title: string;
  url: string;
  organization?: string;
  referenceNumber?: string;
  /** Solicitation type in the source's own words, e.g. "Request for Proposal". */
  noticeTypeHint?: string;
  description?: string;
  publishedAt?: string | null;
  closing?: { iso: string; precision: DatePrecision } | null;
  /** Closing date exactly as the source wrote it. */
  closingRaw?: string;
  location?: string;
  categories?: string[];
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  documents?: DocumentLink[];
  status?: OpportunityStatus;
  /** Known to be a British Columbia notice (e.g. mirrored from BC Bid). */
  bcSource?: boolean;
}

export interface ConnectorContext {
  http: HttpClient;
  now: Date;
  region: RegionSettings;
  /** Saved per-source state (e.g. the ETag of a large file). */
  state: Record<string, unknown>;
  /** Called with progress notes shown in the source's health line. */
  note(message: string): void;
}

export interface ListResult {
  items: RawOpportunity[];
  /** The source reported "not modified": keep everything already known. */
  unchanged?: boolean;
  /** New per-source state to save. */
  state?: Record<string, unknown>;
}

export interface Connector {
  kind: SourceKind;
  /** Read the source's current listing. */
  list(source: SourceRecord, ctx: ConnectorContext): Promise<ListResult>;
  /** Read one notice's own page for the full description, dates and documents. */
  detail?(source: SourceRecord, item: RawOpportunity, ctx: ConnectorContext): Promise<Partial<RawOpportunity> | null>;
}

export interface SourceOutcome {
  status: SourceStatus;
  message: string;
  items: RawOpportunity[];
  unchanged: boolean;
  state?: Record<string, unknown>;
  ms: number;
}
