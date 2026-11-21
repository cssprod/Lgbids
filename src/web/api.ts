/**
 * Thin fetch wrapper for the Lgbids HTTP API (see src/shared/api.ts).
 * Errors from the server arrive as `{ error: "sentence" }` and are thrown as
 * ApiError with that sentence, so screens can show it as is.
 */

import type { ActionResult, AlertImportResult, OkResult, PasteAlertResult } from '../shared/api.js';
import type {
  Award,
  AwardInput,
  CoverageRow,
  FeedbackInput,
  FeedbackRecord,
  InsightsDays,
  ManualOpportunityInput,
  MissedBidInput,
  Opportunity,
  OpportunityFilterInput,
  PasteAlertInput,
  Recipient,
  RecipientInput,
  RecipientPatch,
  ResultsInsights,
  SavedSearch,
  SavedSearchInput,
  SavedSearchPatch,
  ScoringInsights,
  StatusInfo,
} from '../shared/schemas.js';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface MockResponse {
  status: number;
  body: unknown;
}
type MockHandler = (method: string, path: string, body: unknown) => Promise<MockResponse>;

/**
 * Dev-only sample data. The condition is replaced at build time, so in a
 * production build the mock module is never loaded.
 */
const mockHandler: Promise<MockHandler> | null =
  import.meta.env.VITE_MOCK === '1' ? import('./mock.js').then((m) => m.handleMock) : null;

export const usingMock = mockHandler !== null;

let unauthorizedListener: (() => void) | null = null;

/** Called whenever the server answers 401, so the app can show the sign-in screen. */
export function onUnauthorized(listener: (() => void) | null): void {
  unauthorizedListener = listener;
}

function fallbackMessage(status: number): string {
  if (status === 401) return 'Please sign in again.';
  if (status === 404) return 'That item no longer exists. It may have been removed.';
  if (status === 409) return 'That cannot be done right now.';
  if (status === 413) return 'That file is too large.';
  if (status >= 500) return 'The server ran into a problem. Please try again in a moment.';
  return 'The request was not accepted. Please check the form and try again.';
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let status: number;
  let data: unknown;
  if (mockHandler) {
    const res = await (await mockHandler)(method, path, body);
    status = res.status;
    data = res.body;
  } else {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(path, init);
    } catch {
      throw new ApiError('Could not reach the Lgbids server. Check that it is running, then try again.', 0);
    }
    status = res.status;
    data = parseBody(await res.text());
  }

  const isAuthRoute = path.startsWith('/api/login') || path.startsWith('/api/session');
  if (status === 401 && !isAuthRoute) unauthorizedListener?.();

  if (status >= 400) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : fallbackMessage(status);
    throw new ApiError(message, status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// v2 routes (see src/shared/api.ts). One function per route, so pages and
// components never spell out a path or a body shape themselves.
// ---------------------------------------------------------------------------

/** Query string for the opportunity list and its CSV; defaults and empty values are left out. */
export function opportunityQuery(filter: Partial<OpportunityFilterInput> & { limit?: number; offset?: number }): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === null || value === undefined || value === '') continue;
    q.set(key, String(value));
  }
  return q.toString();
}

const opp = (id: number, rest = '') => `/api/opportunities/${id}${rest}`;

// Watching a bid
export const setAlertsMuted = (id: number, muted: boolean) => api.post<Opportunity>(opp(id, '/alerts'), { muted });
export const markChangesSeen = (id: number) => api.post<Opportunity>(opp(id, '/changes/seen'));

// Feedback on scores
export const saveFeedback = (id: number, input: FeedbackInput) => api.put<FeedbackRecord>(opp(id, '/feedback'), input);
export const deleteFeedback = (id: number) => api.del<OkResult>(opp(id, '/feedback'));
export const reportMissedBid = (input: MissedBidInput) => api.post<FeedbackRecord>('/api/feedback/missed', input);
export const listFeedback = () => api.get<FeedbackRecord[]>('/api/feedback');
export const FEEDBACK_CSV_URL = '/api/feedback.csv';
export const FEEDBACK_CORPUS_URL = '/api/feedback/corpus.jsonl';

// Insights
export const getScoringInsights = (days: InsightsDays) => api.get<ScoringInsights>(`/api/insights/scoring?days=${days}`);
export const getResultsInsights = () => api.get<ResultsInsights>('/api/insights/results');

// Awards
export const saveAward = (id: number, input: AwardInput) => api.put<Award>(opp(id, '/award'), input);
export const deleteAward = (id: number) => api.del<OkResult>(opp(id, '/award'));

// Saved searches
export const listSavedSearches = () => api.get<SavedSearch[]>('/api/saved-searches');
export const createSavedSearch = (input: SavedSearchInput) => api.post<SavedSearch>('/api/saved-searches', input);
export const updateSavedSearch = (id: number, patch: SavedSearchPatch) => api.patch<SavedSearch>(`/api/saved-searches/${id}`, patch);
export const deleteSavedSearch = (id: number) => api.del<OkResult>(`/api/saved-searches/${id}`);

// Coverage
export const getCoverage = () => api.get<CoverageRow[]>('/api/coverage');

// Bids added by hand
export const addManualOpportunity = (input: ManualOpportunityInput) => api.post<Opportunity>('/api/opportunities/manual', input);
export const pasteAlert = (input: PasteAlertInput) => api.post<PasteAlertResult>('/api/opportunities/paste-alert', input);
export const importAlertFile = (form: FormData) => api.upload<AlertImportResult>('/api/alerts/import', form);

// Alert recipients
export const listRecipients = () => api.get<Recipient[]>('/api/recipients');
export const createRecipient = (input: RecipientInput) => api.post<Recipient>('/api/recipients', input);
export const updateRecipient = (id: number, patch: RecipientPatch) => api.patch<Recipient>(`/api/recipients/${id}`, patch);
export const deleteRecipient = (id: number) => api.del<OkResult>(`/api/recipients/${id}`);
export const testRecipient = (id: number) => api.post<ActionResult>(`/api/recipients/${id}/test`);

// Status
export const getStatus = () => api.get<StatusInfo>('/api/status');
