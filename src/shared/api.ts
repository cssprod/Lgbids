import type { Application, Dashboard, EmailSettings, Opportunity, Profile, RunRecord, SourceStatus } from './schemas.js';

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
 * GET    /api/opportunities?view&q&sourceId&limit&offset -> OpportunityList
 * GET    /api/opportunities/:id               -> Opportunity
 * POST   /api/opportunities/:id/decision {decision: 'pursue'|'dismissed'|null} -> Opportunity
 *          ('pursue' also drafts the application)
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

export interface RunState {
  running: boolean;
  run: RunRecord | null;
}

export type { Application };
