/**
 * Thin fetch wrapper for the Lgbids HTTP API (see src/shared/api.ts).
 * Errors from the server arrive as `{ error: "sentence" }` and are thrown as
 * ApiError with that sentence, so screens can show it as is.
 */

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
