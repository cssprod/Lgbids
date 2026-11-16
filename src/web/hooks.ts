import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from './api.js';
import type { DatePrecision } from '../shared/schemas.js';
import { closingText, formatDate, formatDateTime, formatShort, relative } from './format.js';

// ---------------------------------------------------------------------------
// App-wide information
// ---------------------------------------------------------------------------

export interface AppInfo {
  timeZone: string;
  demo: boolean;
  authRequired: boolean;
  signOut: () => void;
}

export const AppContext = createContext<AppInfo>({
  timeZone: 'America/Vancouver',
  demo: false,
  authRequired: false,
  signOut: () => {},
});

export function useApp(): AppInfo {
  return useContext(AppContext);
}

/** Date formatters bound to the business's time zone. */
export function useFormat() {
  const { timeZone } = useApp();
  return useMemo(
    () => ({
      timeZone,
      dateTime: (iso: string | null | undefined) => formatDateTime(iso, timeZone),
      date: (iso: string | null | undefined) => formatDate(iso, timeZone),
      short: (iso: string | null | undefined) => formatShort(iso, timeZone),
      relative: (iso: string | null | undefined, precision: DatePrecision | null = 'datetime') => relative(iso, timeZone, precision),
      closing: (iso: string | null, precision: DatePrecision | null, raw = '') => closingText(iso, precision, raw, timeZone),
    }),
    [timeZone],
  );
}

// ---------------------------------------------------------------------------
// Loading data
// ---------------------------------------------------------------------------

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
}

/** GET a path and keep the result. Pass null to wait (e.g. until an id is known). */
export function useResource<T>(path: string | null): Resource<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<T>(path).then(
      (d) => {
        if (cancelled) return;
        setDataState(d);
        setLoading(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(errorMessage(e));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((d: T) => setDataState(d), []);
  return { data, error, loading, reload, setData };
}

// ---------------------------------------------------------------------------
// Actions (save, send, delete...) with a result message for an aria-live region
// ---------------------------------------------------------------------------

export interface ActionMessage {
  ok: boolean;
  text: string;
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <R,>(fn: () => Promise<R>, success?: string | ((r: R) => string)): Promise<R | undefined> => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      if (mounted.current) {
        const text = typeof success === 'function' ? success(r) : success;
        setMessage(text ? { ok: true, text } : null);
      }
      return r;
    } catch (e) {
      if (mounted.current) setMessage({ ok: false, text: errorMessage(e) });
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  const clear = useCallback(() => setMessage(null), []);
  return { busy, message, run, clear, setMessage };
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Lgbids` : 'Lgbids';
  }, [title]);
}

/** Calls fn every `ms` while `active` is true. */
export function useInterval(fn: () => void, ms: number, active: boolean): void {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [ms, active]);
}

/** Warn before leaving the page with unsaved changes (browser close / reload). */
export function useUnsavedWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
