import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';

// Only the hosted beta prototype has the tester bar; the real app never loads it.
const PrototypeBar = import.meta.env.VITE_PROTOTYPE === '1' ? lazy(() => import('./PrototypeBar.js').then((m) => ({ default: m.PrototypeBar }))) : null;
import { NavLink, useLocation } from 'react-router-dom';
import type { DashboardResponse } from '../../shared/api.js';
import { api } from '../api.js';
import { useApp } from '../hooks.js';
import { Icon, type IconName } from './Icon.js';

type Counts = DashboardResponse['counts'];

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  /** Number shown beside the link when something there needs the user. */
  badge?: (c: Counts) => { value: number; label: string; tone: 'warn' | 'bad' | 'brand' } | null;
}

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Work',
    items: [
      { to: '/', label: 'Today', icon: 'home', end: true },
      {
        to: '/opportunities',
        label: 'Opportunities',
        icon: 'search',
        badge: (c) => (c.openSuitable > 0 ? { value: c.openSuitable, label: `${c.openSuitable} suitable and open`, tone: 'brand' } : null),
      },
      {
        to: '/applications',
        label: 'Applications',
        icon: 'inbox',
        badge: (c) => {
          const n = c.needsInput + c.ready;
          return n > 0 ? { value: n, label: `${n} need you`, tone: 'warn' } : null;
        },
      },
    ],
  },
  {
    heading: 'Your company',
    items: [
      { to: '/profile', label: 'Company profile', icon: 'building' },
      { to: '/documents', label: 'Documents', icon: 'file' },
      { to: '/insights', label: 'Insights', icon: 'chart' },
    ],
  },
  {
    heading: 'System',
    items: [
      {
        to: '/sources',
        label: 'Sources',
        icon: 'globe',
        badge: (c) => {
          // Failing and warned sites both need a look; red if anything is failing.
          const warned = c.sourcesWarning ?? 0;
          const n = c.sourcesFailing + warned;
          if (n === 0) return null;
          const parts = [c.sourcesFailing ? `${c.sourcesFailing} failing` : '', warned ? `${warned} to check` : ''].filter(Boolean);
          return { value: n, label: parts.join(', '), tone: c.sourcesFailing > 0 ? 'bad' : 'warn' };
        },
      },
      { to: '/settings', label: 'Settings', icon: 'settings' },
      { to: '/help', label: 'Help', icon: 'help' },
    ],
  },
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
  const [counts, setCounts] = useState<Counts | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  // Close the phone menu after moving to another screen, start at the top, and
  // refresh the nav counts so they follow what the user just did.
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
    let cancelled = false;
    api.get<DashboardResponse>('/api/dashboard').then(
      (d) => {
        if (!cancelled) setCounts(d.counts);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  // A link to "/settings#alerts" lands on that section. Pages load their data
  // after the first paint, so look for the target a few times before giving up.
  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el || ++tries > 20) {
        window.clearInterval(timer);
        el?.scrollIntoView({ block: 'start' });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [location.pathname, location.hash]);

  // Escape closes the phone menu and puts focus back on its button.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className={menuOpen ? 'app menu-open' : 'app'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="sidebar">
        <div className="brand-row">
          <NavLink to="/" className="brand" end>
            <Logo />
            <span>Lgbids</span>
            {demo ? <span className="demo-tag">{PrototypeBar ? 'Beta' : 'Demo'}</span> : null}
          </NavLink>
          <button
            ref={menuButton}
            type="button"
            className="menu-button btn btn-ghost"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} />
            Menu
          </button>
        </div>
        <nav id="main-nav" aria-label="Main" className={menuOpen ? 'nav open' : 'nav'}>
          {NAV.map((group) => (
            <div className="nav-group" key={group.heading}>
              <p className="nav-heading">{group.heading}</p>
              <ul>
                {group.items.map((n) => {
                  const badge = counts && n.badge ? n.badge(counts) : null;
                  return (
                    <li key={n.to}>
                      <NavLink to={n.to} end={n.end}>
                        <Icon name={n.icon} />
                        <span className="nav-label">{n.label}</span>
                        {badge ? (
                          <span className={`nav-badge nav-badge-${badge.tone}`}>
                            <span aria-hidden="true">{badge.value}</span>
                            <span className="visually-hidden">, {badge.label}</span>
                          </span>
                        ) : null}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {authRequired ? (
            <button type="button" className="btn btn-ghost sign-out" onClick={signOut}>
              <Icon name="logout" />
              Sign out
            </button>
          ) : null}
        </nav>
      </header>
      {menuOpen ? <div className="nav-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} /> : null}
      <main id="main" tabIndex={-1}>
        {PrototypeBar ? (
          <Suspense fallback={null}>
            <PrototypeBar />
          </Suspense>
        ) : null}
        {children}
      </main>
    </div>
  );
}
