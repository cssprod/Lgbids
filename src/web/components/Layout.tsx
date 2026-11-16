import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useApp } from '../hooks.js';

const NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Today', end: true },
  { to: '/opportunities', label: 'Opportunities' },
  { to: '/applications', label: 'Applications' },
  { to: '/profile', label: 'Company profile' },
  { to: '/documents', label: 'Documents' },
  { to: '/sources', label: 'Sources' },
  { to: '/settings', label: 'Settings' },
  { to: '/activity', label: 'Activity' },
];

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="var(--brand)" />
      <path d="M32 50c0-14 2-22 12-30-12 1-19 8-19 18 0 5 3 9 7 12z" fill="var(--brand-contrast)" />
      <path d="M32 50c-1-9-5-15-13-18 3 9 7 15 13 18z" fill="var(--brand-contrast)" opacity=".7" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { demo, authRequired, signOut } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the phone menu after moving to another screen, and start at the top.
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="sidebar">
        <div className="brand-row">
          <NavLink to="/" className="brand" end>
            <Logo />
            <span>Lgbids</span>
            {demo ? <span className="demo-tag">Demo</span> : null}
          </NavLink>
          <button
            type="button"
            className="menu-button btn btn-ghost"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span> Menu
          </button>
        </div>
        <nav id="main-nav" aria-label="Main" className={menuOpen ? 'nav open' : 'nav'}>
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
          {authRequired ? (
            <button type="button" className="btn btn-ghost sign-out" onClick={signOut}>
              Sign out
            </button>
          ) : null}
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
