---
name: ui-quality-pass
description: Verify the Lgbids web UI in a real browser — Playwright screenshots of every route at phone and desktop widths in light and dark, console errors, horizontal overflow, keyboard focus, basic accessibility and visual polish review. Use after any UI change, before committing UI work, or when asked to check/test/review how the app looks.
---

# UI quality pass

## 1. Start the app with sample data
- `npm run build` then `npm run demo` in the background (fixture server + SMTP sink, separate `data-demo` dir, DEMO banner). Read the printed port; do not guess it.
- Alternative for UI-only work: `VITE_MOCK=1 npm run dev:web` (mock API in `src/web/mock.ts`).

## 2. Screenshot script (scratchpad, not the repo)
Use the pre-installed Playwright (`require('playwright')`, `chromium.launch()` — never `playwright install`). For each route in `src/web/App.tsx` (`/`, `/opportunities`, one `/opportunities/:id`, `/applications`, one `/applications/:id`, `/profile`, `/documents`, `/sources`, `/settings`, `/activity`, an unknown path, and the login screen with `APP_PASSWORD` set):
- Viewports 1280×800 and 390×844; `colorScheme` `light` and `dark` → 4 shots per route, `deviceScaleFactor: 1` for your own review.
- Collect `page.on('console')` errors and `pageerror`; fail on any.
- Check overflow: `document.documentElement.scrollWidth > innerWidth` → fail.
- Check: exactly one `h1`; every `img` has `alt`; every button/link has an accessible name (`page.accessibility.snapshot()` or a DOM query for empty-text buttons without `aria-label`); inputs have labels.
- Keyboard: from the top, press Tab ~15 times and screenshot to confirm a visible focus ring and logical order; open a dialog, check Esc closes and focus returns.
- Optional when online: inject axe-core from cdnjs and report violations of impact serious/critical.

## 3. Review the screenshots yourself (Read the PNGs)
Look for, and fix:
- Misaligned edges, uneven spacing, text touching borders, inconsistent button sizes.
- Truncated or wrapping labels, orphaned single words in buttons, table columns squashed on phones.
- Low-contrast text or invisible borders in dark mode; colour as the only signal.
- Empty/loading/error states missing or ugly (force them: empty data dir, stop the server for errors).
- More than one primary button per view; primary action not obvious.
- Anything that looks unfinished: placeholder text, raw JSON, ISO dates, `undefined`, `NaN`.

## 4. Golden paths by hand (Playwright steps)
- Fill profile → upload a document → open a suitable opportunity → Pursue → application checklist → enter price → Send → confirm the demo SMTP sink captured it with the package PDF.
- Portal bid → Download package → Mark as submitted → Won.
- Guardrails: second Send refused; closed opportunity cannot be sent; auto mode needs the acknowledgement.

## 5. Report
List each issue found → fixed / left (with reason). Keep the script in the scratchpad; screenshots for the user at `deviceScaleFactor: 2` only if they ask to see them. Stop the demo server when done.
