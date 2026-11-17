import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
import { applyTheme, getTheme } from './theme.js';

// Before the first render, so a chosen theme does not flash the other one.
applyTheme(getTheme());

// With the in-browser sample API there is no server behind /api links, so
// downloads (package PDF, calendar, documents) are built in the browser.
if (import.meta.env.VITE_MOCK === '1') {
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="/api/"]') : null;
      if (!link || event.defaultPrevented || event.button !== 0) return;
      event.preventDefault();
      const href = link.getAttribute('href')!;
      // Open the tab now, inside the click, so pop-up blockers allow it.
      const tab = link.target === '_blank' ? window.open('', '_blank') : null;
      void import('./mock.js')
        .then((m) => m.mockDownload(href))
        .then((file) => {
          if (!file) {
            tab?.close();
            return;
          }
          const url = URL.createObjectURL(file.blob);
          if (tab) {
            tab.location.href = url;
          } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = file.filename;
            a.click();
          }
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        });
    },
    true,
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
