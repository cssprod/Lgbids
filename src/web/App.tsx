import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { api, errorMessage, onUnauthorized } from './api.js';
import type { DashboardResponse, SessionInfo } from '../shared/api.js';
import { AppContext, type AppInfo } from './hooks.js';
import { Layout } from './components/Layout.js';
import { ToastProvider } from './components/Toast.js';
import { Empty, ErrorBox, Loading, SkeletonList } from './components/ui.js';
import { LoginPage } from './pages/Login.js';
import { DashboardPage } from './pages/Dashboard.js';
import { OpportunitiesPage } from './pages/Opportunities.js';
import { OpportunityDetailPage } from './pages/OpportunityDetail.js';
import { ApplicationsPage } from './pages/Applications.js';

// Less-used and heavier screens load on first visit, keeping the first download small.
const ApplicationDetailPage = lazy(() => import('./pages/ApplicationDetail.js').then((m) => ({ default: m.ApplicationDetailPage })));
const ProfilePage = lazy(() => import('./pages/Profile.js').then((m) => ({ default: m.ProfilePage })));
const DocumentsPage = lazy(() => import('./pages/Documents.js').then((m) => ({ default: m.DocumentsPage })));
const SourcesPage = lazy(() => import('./pages/Sources.js').then((m) => ({ default: m.SourcesPage })));
const SettingsPage = lazy(() => import('./pages/Settings.js').then((m) => ({ default: m.SettingsPage })));
const ActivityPage = lazy(() => import('./pages/Activity.js').then((m) => ({ default: m.ActivityPage })));
const InsightsPage = lazy(() => import('./pages/Insights.js').then((m) => ({ default: m.InsightsPage })));
const HelpPage = lazy(() => import('./pages/Help.js').then((m) => ({ default: m.HelpPage })));

/** Shows its content only if loading takes longer than a moment, so fast loads do not flash a spinner. */
function Delayed({ children, ms = 400 }: { children: ReactNode; ms?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return show ? <>{children}</> : null;
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState('America/Vancouver');

  const loadSession = useCallback(() => {
    setSessionError(null);
    api.get<SessionInfo>('/api/session').then(setSession, (e: unknown) => setSessionError(errorMessage(e)));
  }, []);

  useEffect(() => {
    loadSession();
    onUnauthorized(() => setSession((s) => (s ? { ...s, authRequired: true, authenticated: false } : s)));
    return () => onUnauthorized(null);
  }, [loadSession]);

  const signedIn = session !== null && (!session.authRequired || session.authenticated);

  // The business's time zone comes with the dashboard; every screen shows dates in it.
  useEffect(() => {
    if (!signedIn) return;
    api.get<DashboardResponse>('/api/dashboard').then(
      (d) => {
        if (d.timeZone) setTimeZone(d.timeZone);
      },
      () => {},
    );
  }, [signedIn]);

  const signOut = useCallback(() => {
    api.post<SessionInfo>('/api/logout').then(setSession, () => loadSession());
  }, [loadSession]);

  const info: AppInfo = useMemo(
    () => ({ timeZone, demo: session?.demo ?? false, authRequired: session?.authRequired ?? false, signOut }),
    [timeZone, session, signOut],
  );

  if (sessionError) {
    return (
      <main className="center-screen">
        <ErrorBox message={sessionError} onRetry={loadSession} />
      </main>
    );
  }
  if (!session) {
    return (
      <main className="center-screen">
        <Delayed>
          <Loading label="Opening Lgbids…" />
        </Delayed>
      </main>
    );
  }
  if (!signedIn) {
    return <LoginPage onSignedIn={setSession} />;
  }

  return (
    <AppContext.Provider value={info}>
      <ToastProvider>
      <BrowserRouter>
        <Layout>
          <Suspense fallback={<SkeletonList rows={6} />}>
          <Routes>
            <Route path="/" element={<DashboardPage onTimeZone={setTimeZone} />} />
            <Route path="/opportunities" element={<OpportunitiesPage />} />
            <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/:id" element={<ApplicationDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route
              path="*"
              element={
                <>
                  <h1 className="visually-hidden">Page not found</h1>
                  <Empty title="This page does not exist." action={<Link to="/" className="btn btn-primary">Go to today’s overview</Link>}>
                    <p>The link may be old or mistyped.</p>
                  </Empty>
                </>
              }
            />
          </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
      </ToastProvider>
    </AppContext.Provider>
  );
}
