import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { api, errorMessage, onUnauthorized } from './api.js';
import type { DashboardResponse, SessionInfo } from '../shared/api.js';
import { AppContext, type AppInfo } from './hooks.js';
import { Layout } from './components/Layout.js';
import { Empty, ErrorBox, Loading } from './components/ui.js';
import { LoginPage } from './pages/Login.js';
import { DashboardPage } from './pages/Dashboard.js';
import { OpportunitiesPage } from './pages/Opportunities.js';
import { OpportunityDetailPage } from './pages/OpportunityDetail.js';
import { ApplicationsPage } from './pages/Applications.js';
import { ApplicationDetailPage } from './pages/ApplicationDetail.js';
import { ProfilePage } from './pages/Profile.js';
import { DocumentsPage } from './pages/Documents.js';
import { SourcesPage } from './pages/Sources.js';
import { SettingsPage } from './pages/Settings.js';
import { ActivityPage } from './pages/Activity.js';

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
        <Loading label="Opening Lgbids…" />
      </main>
    );
  }
  if (!signedIn) {
    return <LoginPage onSignedIn={setSession} />;
  }

  return (
    <AppContext.Provider value={info}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<DashboardPage onTimeZone={setTimeZone} />} />
            <Route path="/opportunities" element={<OpportunitiesPage />} />
            <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/:id" element={<ApplicationDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route
              path="*"
              element={
                <Empty title="This page does not exist." action={<Link to="/">Go to today’s overview</Link>}>
                  <p>The link may be old or mistyped.</p>
                </Empty>
              }
            />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AppContext.Provider>
  );
}
