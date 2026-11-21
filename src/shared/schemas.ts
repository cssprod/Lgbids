import './zodConfig.js';
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

export const SOURCE_KINDS = ['canadabuys_csv', 'canadabuys_search', 'bonfire', 'rss', 'html_list', 'email_alerts', 'manual'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  canadabuys_csv: 'CanadaBuys open data (CSV)',
  canadabuys_search: 'CanadaBuys website search',
  bonfire: 'Bonfire / Euna portal',
  rss: 'RSS or Atom feed',
  html_list: 'Web page listing',
  email_alerts: 'Bid alert e-mails',
  manual: 'Added by hand',
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

/** True for a host name that only works on this computer or the local network. */
export function isLocalHostName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return !host.includes('.') && !host.includes(':');
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/**
 * Why an app address cannot be used in alert links, or null when it can:
 * https anywhere, or plain http only on this computer or the local network.
 */
export function appUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'The app address is not a web address. It should look like https://bids.example.com or http://192.168.1.20:3000.';
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostName(url.hostname))) {
    return 'The app address must start with https:// (plain http:// only works for this computer or your local network).';
  }
  if (url.username || url.password) return 'Leave the user name and password out of the app address.';
  if (url.search || url.hash) return 'Use the app address only, without ? or # parts.';
  return null;
}

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

  /** Closing reminders (push and e-mail). They have their own switch and are sent even when the mode is Off. */
  notifyReminders: z.boolean().default(true),
  /** Alerts when a bid you are pursuing changes (moved closing, addendum, cancelled, awarded). */
  notifyChanges: z.boolean().default(true),
  /** Hours before closing at which a reminder is sent, largest first. Empty = no reminders. */
  reminderHours: z
    .array(z.number().int().min(1).max(336))
    .max(6)
    .transform((hours) => [...new Set(hours)].sort((a, b) => b - a))
    .default([72, 24]),
  /** The address this app is reached at, for "Open in Lgbids" links in alerts. Empty = no links. */
  appUrl: z
    .string()
    .trim()
    .max(300)
    .superRefine((v, ctx) => {
      const problem = v === '' ? null : appUrlProblem(v);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .transform((v) => v.replace(/\/+$/, ''))
    .default(''),
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

/** The mailbox that receives BC Bid and Bonfire alert e-mails. Read-only access over IMAP. */
export const alertInboxSchema = z.object({
  host: text(200).default('imap.gmail.com'),
  port: z.number().int().min(1).max(65535).default(993),
  /** Gmail and most providers use implicit TLS on 993. */
  secure: z.boolean().default(true),
  user: text(200),
  /** An app password (Gmail: Google Account → Security → App passwords). Never returned by the API. */
  pass: z.string().max(500).default(''),
  /** The folder or Gmail label the alerts are filtered into. */
  folder: z.string().trim().min(1).max(200).default('INBOX'),
  /** Only alerts received in the last this-many days are read on the first check. */
  lookbackDays: z.number().int().min(1).max(90).default(30),
  verifiedAt: z.string().nullable().default(null),
});
export type AlertInboxSettings = z.infer<typeof alertInboxSchema>;

/** Phone push alerts after each check. */
export const PUSH_PROVIDERS = ['off', 'telegram', 'ntfy'] as const;
export type PushProvider = (typeof PUSH_PROVIDERS)[number];

export const DEFAULT_NTFY_SERVER = 'https://ntfy.sh';

/**
 * Why an ntfy server address cannot be used, or null when it can. Only https,
 * except plain http to this computer (a self-hosted ntfy on the same machine).
 */
export function ntfyServerProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'This is not a web address. It should look like https://ntfy.sh.';
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return 'Use an address that starts with https:// (plain http:// only works for a server on this computer).';
  }
  if (url.username || url.password) return 'Leave the user name and password out of the address; use the access token field instead.';
  if (url.search || url.hash) return 'Use the server address only, without ? or # parts.';
  return null;
}

export const pushSettingsSchema = z.object({
  provider: z.enum(PUSH_PROVIDERS).default('off'),
  /** Telegram bot token from BotFather. Never returned by the API. */
  telegramToken: z
    .string()
    .trim()
    .max(200)
    .regex(/^(\d{5,16}:[A-Za-z0-9_-]{30,80})?$/, 'This does not look like a bot token from BotFather (numbers, a colon, then letters).')
    .default(''),
  /** A private chat id (digits), a group id (minus sign and digits) or a public @channel name. */
  telegramChatId: z
    .string()
    .trim()
    .max(40)
    .regex(/^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})?$/, 'A chat id is a number (groups start with a minus sign) or an @channel name.')
    .default(''),
  ntfyServer: z
    .string()
    .trim()
    .max(200)
    .superRefine((v, ctx) => {
      const problem = v === '' ? null : ntfyServerProblem(v);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .default(DEFAULT_NTFY_SERVER),
  ntfyTopic: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_-]*$/, 'A topic name can only use letters, digits, - and _.')
    .default(''),
  /** Optional ntfy access token for a protected topic. Never returned by the API. */
  ntfyToken: z.string().trim().max(200).regex(/^[\x21-\x7e]*$/, 'The access token cannot contain spaces.').default(''),
  verifiedAt: z.string().nullable().default(null),
});
export type PushSettings = z.infer<typeof pushSettingsSchema>;

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
  /** "Layout may have changed" warning (a full sentence), or '' when the source looks healthy. */
  layoutWarning: string;
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
  /** Stable id of the rule that gave this reason, e.g. `relevance.none`, `area.nonlocal_government`, `type.award`, `keyword.excluded`, `closed`. */
  code?: string;
}

/** One vocabulary term found in a notice. */
export interface TraceMatch {
  term: string;
  service: ServiceKey;
  /** 1 = weak, 2 = supporting, 3 = decisive on its own. */
  strength: number;
  where: 'title' | 'body';
}

/** How the rules reached a score, kept so feedback can say which rule was wrong. */
export interface AnalysisTrace {
  /** Stable hash of the vocabulary and masks the score was worked out with. */
  lexiconVersion: string;
  /** Id of the service-area branch that decided `area`, e.g. `area.local_buyer`. */
  areaRule: string;
  /** Id of the notice-type rule, e.g. `type.title_keyword`. */
  typeRule: string;
  /** Phrases blanked out because they only look relevant ("treatment plant"). */
  maskHits: string[];
  /** Every term match, not only the ones shown in `matchedTerms`. */
  matches: TraceMatch[];
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
  /** Rule trace (absent on analyses saved before v2). */
  trace?: AnalysisTrace;
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
  /** The user switched off reminders and change alerts for this bid. */
  alertsMuted: boolean;
  /** Changes the user has not marked as seen (silent refinements are not counted). */
  unseenChanges: number;
  /** When the latest change was noticed, or null. */
  lastChangedAt: string | null;
  /** Detail responses only: changes, newest first. */
  changes?: NoticeChange[];
  /** Detail responses only: the award result, suggested or confirmed. */
  award?: Award | null;
  /** Detail responses only: the user's feedback on this notice. */
  myFeedback?: FeedbackRecord | null;
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
  /** When the last closing reminder for it was sent. */
  remindedAt: string | null;
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
  /** Set on the run that first noticed the site may have changed its layout. */
  layoutWarning?: string;
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
  /** Optional steps are shown but not counted in the progress. */
  optional?: boolean;
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
    /** Enabled sources showing a "layout may have changed" warning. */
    sourcesWarning: number;
    /** Changes on bids that the user has not seen yet. */
    unseenChanges: number;
    /** Submitted bids 14 or more days past closing with no result recorded. */
    awaitingResult: number;
  };
  attention: Application[];
  deadlines: Opportunity[];
  setup: SetupItem[];
  sources: SourceRecord[];
}

// ---------------------------------------------------------------------------
// v2: notice events and changes
// ---------------------------------------------------------------------------

/** What a notice (or an alert about it) announces. */
export const NOTICE_EVENTS = ['notice', 'addendum', 'closing_change', 'award', 'result', 'cancellation'] as const;
export type NoticeEvent = (typeof NOTICE_EVENTS)[number];

export const NOTICE_CHANGE_KINDS = [
  'closing_moved',
  /** A same-day date upgraded to a time. Recorded, never alerted. */
  'closing_refined',
  'closing_added',
  'documents_added',
  'status_changed',
  'description_changed',
] as const;
export type NoticeChangeKind = (typeof NOTICE_CHANGE_KINDS)[number];

export interface NoticeChange {
  id: number;
  opportunityId: number;
  kind: NoticeChangeKind;
  /** One plain sentence, e.g. "The closing date moved from 3 June to 10 June." */
  summary: string;
  before: string;
  after: string;
  /** A new document whose name looks like an addendum, amendment or clarification. */
  addendum: boolean;
  detectedAt: string;
  runId: number | null;
  notifiedAt: string | null;
  seenAt: string | null;
}

export const muteSchema = z.object({ muted: z.boolean() });

// ---------------------------------------------------------------------------
// v2: feedback on scores
// ---------------------------------------------------------------------------

export const FEEDBACK_VERDICTS = ['not_relevant', 'missed'] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

export const FEEDBACK_REASONS = ['not_our_work', 'supply_only', 'outside_area', 'too_big_small', 'duplicate', 'our_work', 'in_area', 'other'] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  not_our_work: 'Not the kind of work we do',
  supply_only: 'Supply only, no work on site',
  outside_area: 'Outside our service area',
  too_big_small: 'Too big or too small for us',
  duplicate: 'A copy of another bid',
  our_work: 'This is our kind of work',
  in_area: 'It is inside our service area',
  other: 'Something else',
};

export const feedbackInputSchema = z.object({
  verdict: z.enum(FEEDBACK_VERDICTS),
  reasons: z.array(z.enum(FEEDBACK_REASONS)).max(FEEDBACK_REASONS.length).default([]),
  note: text(1000),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export const missedBidSchema = z.object({
  title: z.string().trim().min(3).max(300),
  url: text(1000),
  organization: text(200),
  /** Where the user saw it, e.g. "BC Bid" or "a phone call". */
  foundVia: text(200),
  note: text(1000),
  /** Notice text pasted by the user, used only to score it. */
  text: text(50_000),
});
export type MissedBidInput = z.infer<typeof missedBidSchema>;

/** A feedback item with a snapshot of how the notice was scored at the time. */
export interface FeedbackRecord {
  id: number;
  /** Null for a bid Lgbids never saw ("Report a bid Lgbids missed"). */
  opportunityId: number | null;
  verdict: FeedbackVerdict;
  reasons: FeedbackReason[];
  note: string;
  title: string;
  url: string;
  organization: string;
  foundVia: string;
  sourceId: string;
  noticeType: NoticeType;
  score: number | null;
  decision: Decision | null;
  matchedTerms: string[];
  services: ServiceKey[];
  area: 'yes' | 'no' | 'unknown';
  areaMatch: string;
  trace: AnalysisTrace | null;
  lexiconVersion: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// v2: awards
// ---------------------------------------------------------------------------

export const AWARD_ORIGINS = ['parsed', 'manual'] as const;
export type AwardOrigin = (typeof AWARD_ORIGINS)[number];
export const AWARD_STATUSES = ['suggested', 'confirmed'] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-06-30.');

export const awardInputSchema = z.object({
  winner: z.string().trim().min(1).max(200),
  amount: z.number().min(0).max(1e10).nullable().default(null),
  awardedOn: isoDay.nullable().default(null),
  notes: text(2000),
});
export type AwardInput = z.infer<typeof awardInputSchema>;

/** Who won a bid. Read from an award notice it is only a suggestion until the user confirms it. */
export interface Award {
  id: number;
  /** The bid this result belongs to (null while an award notice is not linked to one). */
  opportunityId: number | null;
  /** The award or result notice it was read from, if any. */
  noticeOpportunityId: number | null;
  orgKey: string;
  refKey: string;
  title: string;
  winner: string;
  amount: number | null;
  /** The amount exactly as the notice wrote it. */
  amountText: string;
  awardedOn: string | null;
  url: string;
  /** The sentence the values were read from. */
  excerpt: string;
  origin: AwardOrigin;
  status: AwardStatus;
  notes: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// v2: opportunity filters and saved searches
// ---------------------------------------------------------------------------

export const OPPORTUNITY_VIEWS = ['suitable', 'review', 'unsuitable', 'closed', 'dismissed', 'all'] as const;

/** The list filters, as kept in the URL and in a saved search. */
export const opportunityFilterSchema = z.object({
  view: z.enum(OPPORTUNITY_VIEWS).default('suitable'),
  q: text(200),
  sourceId: text(80),
  closingWithinDays: z.number().int().min(1).max(365).nullable().default(null),
  minScore: z.number().int().min(0).max(100).nullable().default(null),
  service: z.enum(SERVICE_KEYS).nullable().default(null),
  /** Matched against the area match and the location, ignoring case. */
  place: text(80),
});
export type OpportunityFilterInput = z.infer<typeof opportunityFilterSchema>;

export const MAX_SAVED_SEARCHES = 20;

export const savedSearchInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  filter: opportunityFilterSchema.prefault({}),
});
export const savedSearchPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  filter: opportunityFilterSchema.optional(),
  position: z.number().int().min(0).max(1000).optional(),
});
export type SavedSearchInput = z.infer<typeof savedSearchInputSchema>;
export type SavedSearchPatch = z.infer<typeof savedSearchPatchSchema>;

export interface SavedSearch {
  id: number;
  name: string;
  filter: OpportunityFilterInput;
  position: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// v2: alert recipients (per person, no logins)
// ---------------------------------------------------------------------------

export const ALERT_KINDS = ['new', 'reminders', 'changes'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  new: 'New suitable bids',
  reminders: 'Closing reminders',
  changes: 'Changes to bids you pursue',
};

/** 'none' = e-mail only. Telegram and ntfy use the company bot token or ntfy server from Phone alerts. */
export const RECIPIENT_CHANNELS = ['none', 'telegram', 'ntfy'] as const;
export type RecipientChannel = (typeof RECIPIENT_CHANNELS)[number];

export const recipientInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: text(200),
  channel: z.enum(RECIPIENT_CHANNELS).default('none'),
  /** A Telegram chat id or an ntfy topic, depending on the channel. */
  chatIdOrTopic: z.string().trim().max(64).default(''),
  kinds: z.array(z.enum(ALERT_KINDS)).max(ALERT_KINDS.length).default(['new', 'reminders', 'changes']),
  savedSearchId: z.number().int().positive().nullable().default(null),
});
export const recipientPatchSchema = recipientInputSchema.partial();
export type RecipientInput = z.infer<typeof recipientInputSchema>;
export type RecipientPatch = z.infer<typeof recipientPatchSchema>;

export interface Recipient {
  id: number;
  name: string;
  email: string;
  channel: RecipientChannel;
  chatIdOrTopic: string;
  kinds: AlertKind[];
  /** New-bid alerts only for bids matching this saved search; null = every suitable bid. */
  savedSearchId: number | null;
  verifiedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// v2: coverage ("Who you hear from")
// ---------------------------------------------------------------------------

export const COVERAGE_STATUSES = ['reading', 'alerts_seen', 'alerts_expected', 'not_covered'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export interface CoverageRow {
  buyer: string;
  /** organizationKey() of the buyer. */
  buyerKey: string;
  status: CoverageStatus;
  /** Enabled sources that read this buyer. */
  sourceIds: string[];
  /** Where this buyer posts bids, in words, e.g. "Its own website and BC Bid". */
  postsOn: string;
  lastNoticeAt: string | null;
  /** The step that closes the gap, as a sentence ('' when nothing is needed). */
  hint: string;
  /** In-app link for the hint, e.g. "/settings#alert-inbox" ('' for none). */
  hintHref: string;
}

// ---------------------------------------------------------------------------
// v2: bids added by hand
// ---------------------------------------------------------------------------

export const manualOpportunitySchema = z.object({
  title: z.string().trim().min(3).max(300),
  buyer: z.string().trim().min(2).max(200),
  /** "2026-06-30" (end of that day) or "2026-06-30T14:00" (local time); null = read it from the text. */
  closing: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, 'Use a date like 2026-06-30, or a date and time like 2026-06-30T14:00.')
    .nullable()
    .default(null),
  /** The notice address, kept as a link only. Lgbids never opens it. */
  link: text(1000),
  submissionMethod: z.enum(SUBMISSION_METHODS).default('unknown'),
  /** Notice text pasted by the user; blanks are filled from it. */
  text: text(50_000),
});
export type ManualOpportunityInput = z.infer<typeof manualOpportunitySchema>;

export const pasteAlertSchema = z
  .object({
    html: z.string().max(2_000_000).default(''),
    text: z.string().max(500_000).default(''),
    /** The sender address of the alert, which tells which service sent it. */
    sender: text(200),
  })
  .refine((v) => v.html.trim() !== '' || v.text.trim() !== '', { message: 'Paste the alert e-mail first.', path: ['text'] });
export type PasteAlertInput = z.infer<typeof pasteAlertSchema>;

// ---------------------------------------------------------------------------
// v2: insights
// ---------------------------------------------------------------------------

export const INSIGHT_DAYS = ['7', '30', 'all'] as const;
export type InsightsDays = 7 | 30 | 'all';

export interface InsightExample {
  feedbackId: number;
  opportunityId: number | null;
  title: string;
}

export interface InsightBreakdown {
  /** The term, area rule, type rule, source id, notice type or area value counted. */
  key: string;
  label: string;
  notRelevant: number;
  missed: number;
  examples: InsightExample[];
}

export interface TermInsight {
  term: string;
  /** Feedback items marked not relevant where this term counted. */
  falsePositives: number;
  decisive: number;
  supporting: number;
  inTitle: number;
  inBody: number;
  examples: InsightExample[];
}

export interface TuningSuggestion {
  kind: 'exclude_keyword' | 'term' | 'place';
  value: string;
  /** Not-relevant items behind it (at least 3). */
  count: number;
  /** Share of the feedback mentioning it that was not relevant (at least 0.6). */
  share: number;
  /** The suggestion as a sentence, e.g. "Add 'janitorial' to excluded words." */
  message: string;
}

export interface ScoringInsights {
  days: InsightsDays;
  /** Start of the window, or null for all time. */
  since: string | null;
  counts: { total: number; notRelevant: number; missed: number };
  terms: TermInsight[];
  areaRules: InsightBreakdown[];
  typeRules: InsightBreakdown[];
  byArea: InsightBreakdown[];
  bySource: InsightBreakdown[];
  byNoticeType: InsightBreakdown[];
  /** Word groups in missed titles that no term matches. */
  uncovered: { ngram: string; count: number; examples: InsightExample[] }[];
  /** Every feedback item scored again under the current rules. */
  rescore: {
    fixed: number;
    stillWrong: number;
    items: { feedbackId: number; opportunityId: number | null; title: string; verdict: FeedbackVerdict; before: Decision | null; after: Decision | null; fixed: boolean }[];
  };
  suggestions: TuningSuggestion[];
  missed: { feedbackId: number; opportunityId: number | null; title: string; url: string; organization: string; score: number | null; decision: Decision | null; createdAt: string }[];
}

export interface ResultsBreakdown {
  key: string;
  label: string;
  submitted: number;
  won: number;
  lost: number;
}

export interface ResultsInsights {
  submitted: number;
  won: number;
  lost: number;
  /** Submitted 14 or more days past closing with no result. */
  awaiting: number;
  /** won / (won + lost), or null with fewer than 3 decided bids. */
  winRate: number | null;
  decided: number;
  /** Sum of your price on won bids. */
  valueWon: number;
  byBuyer: ResultsBreakdown[];
  byType: ResultsBreakdown[];
  recent: {
    applicationId: number;
    opportunityId: number;
    title: string;
    buyer: string;
    status: ApplicationStatus;
    closesAt: string | null;
    yourPrice: number | null;
    winner: string;
    winningPrice: number | null;
    /** (your price − winning price) / winning price × 100, or null. */
    differencePct: number | null;
  }[];
}

// ---------------------------------------------------------------------------
// v2: status (signed-in only)
// ---------------------------------------------------------------------------

export interface StatusInfo {
  version: string;
  schemaVersion: number;
  node: string;
  /** Time-zone database version the runtime uses. */
  tzVersion: string;
  /** The startup time-zone warning, or ''. */
  tzWarning: string;
  uptimeSeconds: number;
  lastRun: { status: RunRecord['status']; startedAt: string; finishedAt: string | null } | null;
  nextRunAt: string | null;
  sourcesFailing: number;
  latestBackup: { name: string; at: string; bytes: number } | null;
  /** Size of the data folder, or null when it could not be measured. */
  dataDirBytes: number | null;
}
