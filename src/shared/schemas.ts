import { z } from 'zod';

/**
 * Types and validation shared by the server and the web UI.
 * The web UI imports types only, so zod is not bundled into the browser.
 */

// ---------------------------------------------------------------------------
// Service categories: what kind of gardening / landscaping work a notice asks
// for, and what the company actually offers.
// ---------------------------------------------------------------------------

export const SERVICE_KEYS = [
  'grounds',
  'lawn',
  'garden',
  'tree',
  'vegetation',
  'install',
  'hardscape',
  'irrigation',
  'restoration',
  'snow',
  'supply',
  'design',
] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SERVICE_LABELS: Record<ServiceKey, string> = {
  grounds: 'Grounds & landscape maintenance',
  lawn: 'Lawn, turf & sports fields',
  garden: 'Garden beds, planting & horticulture',
  tree: 'Tree care & arboriculture',
  vegetation: 'Mowing, brushing & invasive plant control',
  install: 'Landscape construction & installation',
  hardscape: 'Hardscape: walls, paths & paving',
  irrigation: 'Irrigation systems',
  restoration: 'Ecological restoration & native planting',
  snow: 'Snow & ice control',
  supply: 'Supply only: plants, soil, mulch, sod',
  design: 'Landscape design & consulting',
};

export const NOTICE_TYPES = ['ITT', 'RFP', 'RFQ', 'RFSO', 'RFSQ', 'RFEOI', 'RFI', 'NOI', 'AWARD', 'OTHER'] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

export const NOTICE_TYPE_LABELS: Record<NoticeType, string> = {
  ITT: 'Invitation to tender',
  RFP: 'Request for proposals',
  RFQ: 'Request for quotations',
  RFSO: 'Standing offer / as-needed',
  RFSQ: 'Pre-qualification',
  RFEOI: 'Expression of interest',
  RFI: 'Request for information',
  NOI: 'Notice of intent (not open to bids)',
  AWARD: 'Award notice',
  OTHER: 'Other / unspecified',
};

export const SUBMISSION_METHODS = ['email', 'bonfire', 'bcbid', 'bidsandtenders', 'portal', 'hardcopy', 'unknown'] as const;
export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];

export const SUBMISSION_METHOD_LABELS: Record<SubmissionMethod, string> = {
  email: 'Email',
  bonfire: 'Bonfire portal',
  bcbid: 'BC Bid',
  bidsandtenders: 'bids&tenders portal',
  portal: 'Online portal',
  hardcopy: 'Hard copy delivery',
  unknown: 'Not stated — check documents',
};

export const SOURCE_KINDS = ['canadabuys_csv', 'canadabuys_search', 'bonfire', 'rss', 'html_list'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  canadabuys_csv: 'CanadaBuys open data (CSV)',
  canadabuys_search: 'CanadaBuys website search',
  bonfire: 'Bonfire / Euna portal',
  rss: 'RSS or Atom feed',
  html_list: 'Web page listing',
};

// ---------------------------------------------------------------------------
// Company profile
// ---------------------------------------------------------------------------

const text = (max = 2000) => z.string().trim().max(max).default('');

export const referenceSchema = z.object({
  client: text(200),
  contactName: text(200),
  contactInfo: text(200),
  description: text(1000),
  year: text(20),
  value: text(60),
});
export type Reference = z.infer<typeof referenceSchema>;

export const rateSchema = z.object({
  label: text(200),
  unit: text(40),
  rate: z.number().min(0).max(1_000_000).default(0),
});
export type Rate = z.infer<typeof rateSchema>;

const servicesSchema = z
  .object({
    grounds: z.boolean().default(true),
    lawn: z.boolean().default(true),
    garden: z.boolean().default(true),
    tree: z.boolean().default(false),
    vegetation: z.boolean().default(true),
    install: z.boolean().default(true),
    hardscape: z.boolean().default(false),
    irrigation: z.boolean().default(false),
    restoration: z.boolean().default(false),
    snow: z.boolean().default(false),
    supply: z.boolean().default(false),
    design: z.boolean().default(false),
  })
  .prefault({});

const credentialsSchema = z
  .object({
    isaArborist: z.boolean().default(false),
    pesticideApplicator: z.boolean().default(false),
    redSeal: z.boolean().default(false),
    corSafety: z.boolean().default(false),
    firstAid: z.boolean().default(false),
    irrigationCertified: z.boolean().default(false),
  })
  .prefault({});

export const profileSchema = z.object({
  legalName: text(200),
  tradeName: text(200),
  addressLine: text(200),
  city: text(100),
  province: z.string().trim().max(40).default('BC'),
  postalCode: text(12),
  phone: text(40),
  email: text(200),
  website: text(200),
  contactName: text(120),
  contactTitle: text(120),
  signatoryName: text(120),
  signatoryTitle: text(120),

  gstNumber: text(40),
  worksafeNumber: text(40),
  businessLicence: text(300),
  yearEstablished: z.number().int().min(1800).max(2100).nullable().default(null),
  crewSize: z.number().int().min(0).max(100000).nullable().default(null),

  insuranceProvider: text(200),
  insurancePolicy: text(80),
  /** Commercial general liability limit, in dollars. */
  insuranceLiability: z.number().min(0).max(1e9).nullable().default(null),
  insuranceExpiry: text(10),
  bondingAvailable: z.boolean().default(false),
  /** Largest bid/performance bond the company can obtain, in dollars. */
  bondingLimit: z.number().min(0).max(1e10).nullable().default(null),

  services: servicesSchema,
  credentials: credentialsSchema,
  /** Free-text list shown in submissions, e.g. "ISA Certified Arborist PN-1234A". */
  certifications: z.array(z.string().trim().max(200)).max(50).default([]),

  about: text(4000),
  approach: text(4000),
  safety: text(3000),
  environment: text(3000),
  equipment: text(3000),
  team: text(3000),

  references: z.array(referenceSchema).max(20).default([]),
  rates: z.array(rateSchema).max(60).default([]),
});
export type Profile = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const AUTOMATION_MODES = ['off', 'discover', 'prepare', 'auto'] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const AUTOMATION_MODE_LABELS: Record<AutomationMode, string> = {
  off: 'Off — only run when I press “Run now”',
  discover: 'Find & score — no applications drafted',
  prepare: 'Find, score & draft applications for my approval',
  auto: 'Fully automatic — also send complete email submissions',
};

export const automationSchema = z.object({
  mode: z.enum(AUTOMATION_MODES).default('prepare'),
  /** Hours between scheduled runs. */
  intervalHours: z.number().min(1).max(168).default(6),
  /** Suitability score at or above which an opportunity is treated as suitable. */
  suitableThreshold: z.number().int().min(0).max(100).default(60),
  /** Suitability score required before a submission may be sent without review. */
  autoSendThreshold: z.number().int().min(0).max(100).default(75),
  /** Notice types that may be sent without review in fully automatic mode. */
  autoSendTypes: z.array(z.enum(NOTICE_TYPES)).default(['RFQ', 'RFSO', 'RFSQ', 'RFEOI']),
  /** Notice types worth pursuing at all. */
  pursueTypes: z.array(z.enum(NOTICE_TYPES)).default(['ITT', 'RFP', 'RFQ', 'RFSO', 'RFSQ', 'RFEOI', 'OTHER']),
  /** Most submissions the system may send on its own in one day. */
  dailySendCap: z.number().int().min(0).max(100).default(5),
  /** Never send within this many hours of the closing time. */
  sendCutoffHours: z.number().min(0).max(240).default(4),
  /** Opportunities closing sooner than this are flagged for review instead of auto-drafted. */
  minLeadDays: z.number().min(0).max(60).default(2),
  excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(200).default([]),
  includeKeywords: z.array(z.string().trim().min(1).max(80)).max(200).default([]),

  notifyEmail: text(200),
  notifyOnNew: z.boolean().default(true),
  deadlineReminderDays: z.number().int().min(0).max(30).default(3),

  /** Sent with every request to a bid site. */
  userAgent: z.string().trim().min(3).max(200).default('Lgbids/0.1 (bid opportunity monitor)'),
  respectRobots: z.boolean().default(true),
  requestDelayMs: z.number().int().min(250).max(60000).default(1500),
  /** Read publicly linked bid documents (PDF) to find submission instructions. */
  readDocuments: z.boolean().default(true),
});
export type AutomationSettings = z.infer<typeof automationSchema>;

export const emailSettingsSchema = z.object({
  host: text(200),
  port: z.number().int().min(1).max(65535).default(587),
  /** true = implicit TLS (port 465); false = STARTTLS when offered. */
  secure: z.boolean().default(false),
  user: text(200),
  pass: z.string().max(500).default(''),
  fromName: text(200),
  fromEmail: text(200),
  replyTo: text(200),
  bccSelf: z.boolean().default(true),
  verifiedAt: z.string().nullable().default(null),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

export const regionSchema = z.object({
  /** Place names that count as inside the service area. */
  places: z.array(z.string().trim().min(2).max(80)).max(400).default([]),
  /** Place names that put a notice outside the service area even if the buyer is local. */
  excludePlaces: z.array(z.string().trim().min(2).max(80)).max(200).default([]),
  /** Buyers whose work is always inside the service area. */
  organizations: z.array(z.string().trim().min(2).max(120)).max(300).default([]),
});
export type RegionSettings = z.infer<typeof regionSchema>;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const sourceConfigSchema = z.object({
  /** Listing URL, feed URL, CSV URL, or portal base URL depending on the kind. */
  url: z.string().trim().max(1000).default(''),
  /** canadabuys_search: search terms, one request each. Empty = built-in list. */
  queries: z.array(z.string().trim().min(1).max(80)).max(60).default([]),
  /** html_list: regular expression matched against each link's path + query. */
  linkPattern: z.string().trim().max(300).default(''),
  /** html_list: optional CSS selector for one listing row/card. */
  itemSelector: z.string().trim().max(300).default(''),
  /** html_list: query-string parameter used for paging, e.g. "page" or "pn". */
  pageParam: z.string().trim().max(40).default(''),
  /** First page number for pageParam (0 or 1). */
  pageStart: z.number().int().min(0).max(1).default(1),
  maxPages: z.number().int().min(1).max(20).default(1),
  /** Open each listing's own page to read the description, dates and documents. */
  fetchDetails: z.boolean().default(true),
  /** Everything this source lists is inside the service area (a local buyer's own site). */
  localBuyer: z.boolean().default(false),
  /** Everything this source lists is in British Columbia (a province-wide listing). */
  bcOnly: z.boolean().default(false),
  /** Buyer name applied when the listing does not state one. */
  organization: z.string().trim().max(200).default(''),
  /** How bids for this source's notices are normally submitted, when known. */
  defaultSubmission: z.enum(SUBMISSION_METHODS).default('unknown'),
  /** Time zone used for dates that do not state one. */
  timeZone: z.string().trim().max(60).default('America/Vancouver'),
});
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const sourceInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(SOURCE_KINDS),
  enabled: z.boolean().default(true),
  notes: text(1000),
  config: sourceConfigSchema.prefault({}),
});
export type SourceInput = z.infer<typeof sourceInputSchema>;

export type SourceStatus = 'ok' | 'empty' | 'error' | 'blocked' | 'never';

export interface SourceRecord {
  id: string;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  builtin: boolean;
  notes: string;
  config: SourceConfig;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastStatus: SourceStatus;
  lastMessage: string;
  lastItemCount: number | null;
  consecutiveFailures: number;
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export type OpportunityStatus = 'open' | 'closed' | 'cancelled' | 'awarded';
export type Decision = 'suitable' | 'review' | 'unsuitable';
export type UserDecision = 'pursue' | 'dismissed' | null;
export type DatePrecision = 'datetime' | 'date';

export interface DocumentLink {
  name: string;
  url: string;
}

export interface AnalysisReason {
  /** good = counts in favour, warn = needs a look, bad = counts against, block = rules it out. */
  tone: 'good' | 'warn' | 'bad' | 'block';
  text: string;
}

export interface Requirement {
  key:
    | 'site_meeting'
    | 'bid_bond'
    | 'performance_bond'
    | 'insurance'
    | 'worksafe'
    | 'business_licence'
    | 'certification'
    | 'forms'
    | 'pricing'
    | 'references'
    | 'security_clearance'
    | 'questions_deadline';
  label: string;
  /** Short detail lifted from the notice, e.g. "$5,000,000" or a date. */
  detail: string;
  /** Whether the company profile already satisfies it; null = cannot tell. */
  met: boolean | null;
}

export interface Analysis {
  relevance: number;
  matchedTerms: string[];
  services: ServiceKey[];
  area: 'yes' | 'no' | 'unknown';
  areaMatch: string;
  reasons: AnalysisReason[];
  requirements: Requirement[];
  pricing: 'rates' | 'lump_sum' | 'none' | 'unknown';
  alsoListed: { source: string; url: string }[];
}

export interface Opportunity {
  id: number;
  sourceId: string;
  sourceName: string;
  externalId: string;
  title: string;
  organization: string;
  referenceNumber: string;
  noticeType: NoticeType;
  description: string;
  url: string;
  publishedAt: string | null;
  closesAt: string | null;
  closesAtPrecision: DatePrecision | null;
  closesAtRaw: string;
  location: string;
  categories: string[];
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  documents: DocumentLink[];
  submissionMethod: SubmissionMethod;
  submissionEmail: string;
  submissionUrl: string;
  status: OpportunityStatus;
  suitabilityScore: number | null;
  decision: Decision | null;
  userDecision: UserDecision;
  analysis: Analysis | null;
  duplicateOf: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  application: { id: number; status: ApplicationStatus } | null;
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export const APPLICATION_STATUSES = [
  'needs_input',
  'ready',
  'sending',
  'submitted',
  'failed',
  'expired',
  'withdrawn',
  'won',
  'lost',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  needs_input: 'Needs your input',
  ready: 'Ready to submit',
  sending: 'Sending',
  submitted: 'Submitted',
  failed: 'Send failed',
  expired: 'Closed before submitting',
  withdrawn: 'Withdrawn',
  won: 'Won',
  lost: 'Not awarded',
};

export type ApplicationChannel = 'email' | 'portal' | 'manual';

export interface ChecklistItem {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  /** Required items block sending until they are ticked. */
  required: boolean;
}

export interface ApplicationFile {
  id: number;
  name: string;
  size: number;
  mime: string;
}

export interface Application {
  id: number;
  opportunityId: number;
  status: ApplicationStatus;
  channel: ApplicationChannel;
  toEmail: string;
  ccEmail: string;
  subject: string;
  body: string;
  priceTotal: number | null;
  priceNotes: string;
  includeRates: boolean;
  checklist: ChecklistItem[];
  /** Company-library documents attached to this submission. */
  documentIds: number[];
  files: ApplicationFile[];
  /** What still stops this from being sent, in plain language. */
  missing: string[];
  autoGenerated: boolean;
  editedByUser: boolean;
  submittedAt: string | null;
  submittedVia: string;
  submissionRef: string;
  error: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  opportunity?: Opportunity;
}

export const applicationUpdateSchema = z.object({
  toEmail: z.string().trim().max(200).optional(),
  ccEmail: z.string().trim().max(400).optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().max(20000).optional(),
  priceTotal: z.number().min(0).max(1e10).nullable().optional(),
  priceNotes: z.string().trim().max(2000).optional(),
  includeRates: z.boolean().optional(),
  channel: z.enum(['email', 'portal', 'manual']).optional(),
  checklist: z.array(z.object({ key: z.string().max(80), done: z.boolean() })).max(60).optional(),
  documentIds: z.array(z.number().int().positive()).max(40).optional(),
  notes: z.string().max(5000).optional(),
});
export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;

// ---------------------------------------------------------------------------
// Document library
// ---------------------------------------------------------------------------

export const DOCUMENT_KINDS = ['insurance', 'worksafe', 'licence', 'certification', 'reference', 'safety', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  insurance: 'Insurance certificate',
  worksafe: 'WorkSafeBC clearance letter',
  licence: 'Business licence',
  certification: 'Certification',
  reference: 'Reference letter',
  safety: 'Safety program',
  other: 'Other',
};

export interface LibraryDocument {
  id: number;
  name: string;
  kind: DocumentKind;
  filename: string;
  mime: string;
  size: number;
  expiresOn: string;
  attachByDefault: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Runs, events, dashboard
// ---------------------------------------------------------------------------

export interface SourceRunStat {
  sourceId: string;
  name: string;
  status: SourceStatus;
  message: string;
  found: number;
  added: number;
  ms: number;
}

export interface RunStats {
  sources: SourceRunStat[];
  found: number;
  added: number;
  analysed: number;
  suitable: number;
  drafted: number;
  sent: number;
  expired: number;
}

export interface RunRecord {
  id: number;
  trigger: 'schedule' | 'manual' | 'startup' | 'cli';
  status: 'running' | 'ok' | 'partial' | 'error';
  startedAt: string;
  finishedAt: string | null;
  stats: RunStats | null;
  error: string;
}

export interface EventRecord {
  id: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  kind: string;
  message: string;
  opportunityId: number | null;
  applicationId: number | null;
  runId: number | null;
}

export interface SetupItem {
  key: string;
  label: string;
  done: boolean;
  href: string;
}

export interface Dashboard {
  mode: AutomationMode;
  running: boolean;
  lastRun: RunRecord | null;
  nextRunAt: string | null;
  counts: {
    openSuitable: number;
    review: number;
    needsInput: number;
    ready: number;
    submitted: number;
    closingSoon: number;
    sourcesFailing: number;
    sourcesEnabled: number;
  };
  attention: Application[];
  deadlines: Opportunity[];
  setup: SetupItem[];
  sources: SourceRecord[];
}
