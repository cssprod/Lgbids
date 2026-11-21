/**
 * What the mock modules (src/web/mock/*.ts) share with the core mock
 * (src/web/mock.ts): the clock, response helpers and one state object. All
 * state lives in mock.ts, so it is saved and restored in one place; a module
 * reads and changes it through `ctx.state` and never keeps its own.
 */
import type {
  Application,
  Award,
  FeedbackRecord,
  NoticeChange,
  Opportunity,
  Recipient,
  SavedSearch,
  SourceRecord,
} from '../../shared/schemas.js';
import type { MockResponse } from '../api.js';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** The moment the mock was loaded; sample dates are relative to it. */
export const now = Date.now();
export const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

export const ok = (body: unknown): MockResponse => ({ status: 200, body });
export const fail = (status: number, error: string): MockResponse => ({ status, body: { error } });
/** The server's answer for a v2 route whose work package has not landed yet. */
export const notBuilt = (): MockResponse => fail(501, 'Not built yet.');

/** v2 data, saved with the rest of the prototype state. */
export interface MockV2State {
  changes: NoticeChange[];
  feedback: FeedbackRecord[];
  awards: Award[];
  savedSearches: SavedSearch[];
  recipients: Recipient[];
}

export interface MockState {
  opportunities: Opportunity[];
  applications: Application[];
  sources: SourceRecord[];
  v2: MockV2State;
}

export interface MockRequest {
  method: string;
  path: string;
  q: URLSearchParams;
  body: Record<string, unknown>;
  rawBody: unknown;
}

export interface MockContext {
  state: MockState;
  /** A fresh id, shared by every kind of row. */
  newId(): number;
  /** Change one application, recompute what it is missing and answer with it (404 if it is gone). */
  updateApp(id: number, fn: (a: Application) => Application): MockResponse;
  /** Recompute `missing` and needs_input/ready, as the server's reassess does. */
  recompute(a: Application): Application;
}

/** A mock module answers the requests it owns, or returns null to pass them on. */
export type MockModule = (ctx: MockContext, req: MockRequest) => MockResponse | null | Promise<MockResponse | null>;

/** Match a path against a pattern; the captures are returned (or null). */
export function match(path: string, re: RegExp): RegExpExecArray | null {
  return re.exec(path);
}
