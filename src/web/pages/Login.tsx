import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api.js';
import type { SessionInfo } from '../../shared/api.js';
import { Logo } from '../components/Layout.js';
import { Field } from '../components/ui.js';

export function LoginPage({ onSignedIn }: { onSignedIn: (s: SessionInfo) => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.post<SessionInfo>('/api/login', { password });
      if (s.authRequired && !s.authenticated) setError('That password is not right. Please try again.');
      else onSignedIn(s);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-screen login" id="main">
      <form className="card login-card" onSubmit={submit} aria-labelledby="login-title">
        <div className="login-brand">
          <Logo />
          <span>Lgbids</span>
        </div>
        <h1 id="login-title">Sign in</h1>
        <p className="muted">Enter the password set for this Lgbids installation.</p>
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            required
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div aria-live="polite">
          {error ? (
            <p className="live-bad" role="alert">
              <span aria-hidden="true">✕ </span>
              {error}
            </p>
          ) : null}
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || password === ''}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
