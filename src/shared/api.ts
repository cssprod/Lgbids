import type {
  AlertInboxSettings,
  Application,
  Award,
  CoverageRow,
  Dashboard,
  EmailSettings,
  FeedbackRecord,
  NoticeChange,
  Opportunity,
  Profile,
  PushSettings,
  Recipient,
  ResultsInsights,
  RunRecord,
  SavedSearch,
  ScoringInsights,
  SourceStatus,
  StatusInfo,
} from './schemas.js';

/**
 * The HTTP API between the web UI and the server. Types only.
 * Errors are JSON `{ "error": "sentence for the user" }` with a 4xx/5xx status.
 * All bodies are JSON unless noted. Everything except /api/session and
 * /api/login answers 401 when a password is set and the caller is not signed in.
 *
 * GET    /api/session                         -> SessionInfo
 * POST   /api/login            {password}     -> SessionInfo
 * POST   /api/logout                          -> SessionInfo
 *
 * GET    /api/dashboard                       -> DashboardResponse
 *
 * GET    /api/opportunities?view&q&sourceId&closingWithinDays&minScore&service&place&limit&offset -> OpportunityList
 *          (minScore 0–100; service a ServiceKey; place matched against the area match or location, ignoring case)
 * GET    /api/opportunities.csv?view&q&sourceId&closingWithinDays&minScore&service&place -> text/csv (UTF-8 with BOM, every match, attachment)
 * GET    /api/opportunities/:id               -> Opportunity     (with changes, award and myFeedback)
 * POST   /api/opportunities/:id/decision {decision: 'pursue'|'dismissed'|null} -> Opportunity
 *          ('pursue' also drafts the application)
 * POST   /api/opportunities/manual  ManualOpportunityInput -> Opportunity (scored; drafted when suitable and the mode is prepare or auto)
 * POST   /api/opportunities/paste-alert  PasteAlertInput -> PasteAlertResult (the pasted links are never opened)
 *
 * v2 — watching a bid
 * POST   /api/opportunities/:id/alerts {muted}  -> Opportunity  (reminders and change alerts for this bid)
 * POST   /api/opportunities/:id/changes/seen    -> Opportunity  (marks every change as seen)
 *
 * v2 — feedback on scores
 * PUT    /api/opportunities/:id/feedback  FeedbackInput -> FeedbackRecord ('not_relevant' also dismisses the bid)
 * DELETE /api/opportunities/:id/feedback        -> {ok: true}
 * POST   /api/feedback/missed   MissedBidInput   -> FeedbackRecord
 * GET    /api/feedback                          -> FeedbackRecord[]  (newest first)
 * GET    /api/feedback.csv                      -> text/csv (UTF-8 with BOM, attachment)
 * GET    /api/feedback/corpus.jsonl             -> application/x-ndjson (public notice fields only, eval-corpus rows)
 *
 * v2 — insights
 * GET    /api/insights/scoring?days=7|30|all    -> ScoringInsights (default 30)
 * GET    /api/insights/results                  -> ResultsInsights
 *
 * v2 — awards (any opportunity)
 * PUT    /api/opportunities/:id/award  AwardInput -> Award   (confirms it)
 * DELETE /api/opportunities/:id/award           -> {ok: true}
 *
 * v2 — saved searches (at most 20; names unique ignoring case, 409 when taken)
 * GET    /api/saved-searches                    -> SavedSearch[]
 * POST   /api/saved-searches    SavedSearchInput -> SavedSearch
 * PATCH  /api/saved-searches/:id  SavedSearchPatch -> SavedSearch
 * DELETE /api/saved-searches/:id                -> {ok: true}
 *
 * v2 — coverage ("Who you hear from")
 * GET    /api/coverage                          -> CoverageRow[]
 *
 * v2 — alert recipients (no logins; tokens stay in Phone alerts)
 * GET    /api/recipients                        -> Recipient[]
 * POST   /api/recipients        RecipientInput   -> Recipient
 * PATCH  /api/recipients/:id    RecipientPatch   -> Recipient
 * DELETE /api/recipients/:id                    -> {ok: true}
 * POST   /api/recipients/:id/test               -> ActionResult
 *
 * v2 — status (signed in only; /api/health stays public)
 * GET    /api/status                            -> StatusInfo
 * GET    /api/health                            -> {ok: true} (503 {ok: false} when the database check fails)
 *
 * GET    /api/applications?status=a,b         -> Application[]   (each with .opportunity)
 * GET    /api/applications/:id                -> Application     (with .opportunity)
 * PATCH  /api/applications/:id  ApplicationUpdate -> Application
 * POST   /api/applications/:id/regenerate     -> Application     (rebuild letter from profile)
 * POST   /api/applications/:id/send           -> Application     (e-mail it now; 409 with reason if not allowed)
 * POST   /api/applications/:id/mark-submitted {via, ref?, note?} -> Application
 * POST   /api/applications/:id/status {status: 'withdrawn'|'won'|'lost'|'needs_input'} -> Application
 * GET    /api/applications/:id/package.pdf    -> application/pdf
 * POST   /api/applications/:id/files          multipart "file" -> Application
 * GET    /api/applications/:id/files/:fileId  -> the file
 * DELETE /api/applications/:id/files/:fileId  -> Application
 *
 * GET    /api/profile                         -> ProfileResponse
 * PUT    /api/profile           Profile       -> ProfileResponse
 *
 * GET    /api/settings/automation             -> AutomationSettings
 * PUT    /api/settings/automation             -> AutomationSettings
 * GET    /api/settings/region                 -> RegionSettings
 * PUT    /api/settings/region                 -> RegionSettings
 * POST   /api/settings/region/reset           -> RegionSettings
 * GET    /api/settings/email                  -> EmailSettingsView
 * PUT    /api/settings/email    (EmailSettings; empty pass keeps the saved one) -> EmailSettingsView
 * POST   /api/settings/email/test {to?}       -> ActionResult
 * GET    /api/settings/alert-inbox            -> AlertInboxView
 * PUT    /api/settings/alert-inbox (AlertInboxSettings; empty pass keeps the saved one) -> AlertInboxView
 * POST   /api/settings/alert-inbox/test       -> ActionResult
 * GET    /api/settings/push                   -> PushSettingsView
 * PUT    /api/settings/push    PushSettingsInput -> PushSettingsView
 * POST   /api/settings/push/test              -> ActionResult   (sends a test alert with the saved settings)
 * POST   /api/settings/push/telegram-chat     -> TelegramChatResult (finds and saves the chat that last messaged the bot)
 * POST   /api/alerts/import     multipart: one .eml file -> AlertImportResult (parsed at once: "Found 2 notices: …" or "Not recognised; kept so it can be checked")
 *
 * GET    /api/sources                         -> SourceRecord[]
 * POST   /api/sources           SourceInput   -> SourceRecord
 * PATCH  /api/sources/:id       Partial<SourceInput> -> SourceRecord
 * DELETE /api/sources/:id                     -> {ok: true}     (built-in sources can only be disabled)
 * POST   /api/sources/:id/test                -> SourceTest
 * POST   /api/sources/test      SourceInput   -> SourceTest     (try before saving)
 *
 * GET    /api/documents                       -> LibraryDocument[]
 * POST   /api/documents         multipart: file, name, kind, expiresOn, attachByDefault -> LibraryDocument
 * PATCH  /api/documents/:id     {name?, kind?, expiresOn?, attachByDefault?} -> LibraryDocument
 * DELETE /api/documents/:id                   -> {ok: true}
 * GET    /api/documents/:id/download          -> the file
 *
 * GET    /api/runs                            -> RunRecord[]
 * POST   /api/runs                            -> RunState       (starts a run; 409 if one is running)
 * GET    /api/runs/current                    -> RunState
 * GET    /api/events?limit                    -> EventRecord[]
 * GET    /api/calendar.ics                    -> text/calendar  (closing dates of suitable opportunities)
 */

export interface SessionInfo {
  /** A password is configured. */
  authRequired: boolean;
  authenticated: boolean;
  demo: boolean;
}

export interface DashboardResponse extends Dashboard {
  demo: boolean;
  timeZone: string;
}

export type OpportunityViewName = 'suitable' | 'review' | 'unsuitable' | 'closed' | 'dismissed' | 'all';

export interface OpportunityList {
  items: Opportunity[];
  total: number;
  counts: Record<OpportunityViewName, number>;
}

export interface ProfileResponse {
  profile: Profile;
  /** Fields still needed before any submission can be sent, in plain language. */
  missing: string[];
}

export type EmailSettingsView = Omit<EmailSettings, 'pass'> & {
  hasPassword: boolean;
  /** Fields supplied by SMTP_* environment variables (shown read-only). */
  fromEnvironment: string[];
};

export type AlertInboxView = Omit<AlertInboxSettings, 'pass'> & { hasPassword: boolean };

/** Push settings without the secrets; the booleans say whether one is saved. */
export type PushSettingsView = Omit<PushSettings, 'telegramToken' | 'ntfyToken'> & { hasTelegramToken: boolean; hasNtfyToken: boolean };

/** PUT /api/settings/push body: empty tokens keep the saved ones; removeNtfyToken forgets it. */
export type PushSettingsInput = Omit<PushSettings, 'verifiedAt'> & { removeNtfyToken?: boolean };

export interface TelegramChatResult extends ActionResult {
  /** The chat that was found and saved, when ok. */
  chatId?: string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface SourceTest {
  status: SourceStatus;
  message: string;
  ms: number;
  count: number;
  sample: { title: string; url: string; organization: string; closesAt: string | null; closingRaw: string; referenceNumber: string }[];
  requests: { url: string; status: number | null; bytes: number; ms: number; error?: string }[];
}

/** POST /api/alerts/import. */
export interface AlertImportResult extends ActionResult {
  /** False when no notice could be read; the file is kept so it can be checked. */
  recognised: boolean;
  /** Titles of the notices found. */
  titles: string[];
}

/** POST /api/opportunities/paste-alert. */
export interface PasteAlertResult extends ActionResult {
  recognised: boolean;
  /** Notices found in the pasted alert. */
  found: number;
  /** Ids of the bids added or updated. */
  ids: number[];
}

export interface OkResult {
  ok: true;
}

export interface HealthResult {
  ok: boolean;
}

export type {
  Award,
  CoverageRow,
  FeedbackRecord,
  NoticeChange,
  Recipient,
  ResultsInsights,
  SavedSearch,
  ScoringInsights,
  StatusInfo,
};

export interface RunState {
  running: boolean;
  run: RunRecord | null;
}

export type { Application };
