/**
 * Light, dark or follow the system. The choice is per browser (localStorage);
 * if storage is unavailable the app simply follows the system setting.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'lgbids.theme';
const THEME_COLOR = { light: '#1f4d3a', dark: '#141613' };

export function getTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  // The browser bar colour follows the chosen theme (or the system's, through the media queries).
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const forDark = meta.media.includes('dark');
    meta.content = choice === 'system' ? THEME_COLOR[forDark ? 'dark' : 'light'] : THEME_COLOR[choice];
  }
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // Not remembered, but still applied for this visit.
  }
  applyTheme(choice);
}
