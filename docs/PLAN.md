# Lgbids — plan to deployment and beta

## Context
Lgbids finds gardening/landscaping bids in Greater Victoria, scores them, drafts submissions and e-mails them (portal bids are packaged for upload). Five parallel agents built the modules; two (API server, web UI) were cut off by the usage limit near the end. Current state, checked read-only on 2026-11-17:
- Server and web UI both typecheck with 0 errors; 238/239 tests pass (1 failing: `tests/api.test.ts` "refuses state-changing requests from another origin").
- All screens exist in `src/web/pages` (Dashboard, Opportunities, Applications, Profile, Documents, Sources, Settings, Activity, Login), with an in-memory mock in `src/web/mock.ts`.
- Missing: `src/web/public` (manifest + icons); the app has never been built and run end to end; no browser check; uncommitted edits in `pipeline/run.ts`, `notify.ts`, `notice.ts`, tests.
- Connectors are unverified against live sites (network access was declined in this sandbox) — the beta is where that gets tested.

Goal: a build anyone can install and run, verified in demo mode, then a beta with real sources and a real company profile.

Working rule for every phase: one task at a time, `npm test` + both typechecks green, commit and push after each task (branch `ccr-d5d1aeaf-xi4ohg`). Lead model on Opus; spawn at most 2 agents at once and only for the independent tasks marked ⇉.

---

## Progress
- Phase 1 done (2026-11-17): origin-check fix, stylesheet, manifest + icons, build works, UI found when run from source.
- Phase 2 done: demo run ok (8 sources, 32 notices, 11 suitable); every screen checked at desktop/phone, light/dark, no console errors or overflow; send flow, second-send refusal, portal package, mark submitted, won, and auto-mode acknowledgement all verified in Chromium. Fixed: zod eval probe vs CSP, layout bugs, outdated browser tz data showing BC times an hour early.
- Phase 3 done except running Docker (no daemon in the sandbox): /api/health, 180-day history pruning, HEALTHCHECK, startup guard verified, focused security check (uploads, cookies, password handling, file names). A full /security-review was not run.
- Next: Phase 4 (live sources) needs the user — see Decisions needed.

## Phase 1 — Finish and integrate (sandbox)
1. Commit the current uncommitted work (auto mode now waives only the "I have read the documents" tick; cover note regenerated at send time with the price; better RFQ detection). Record the auto-mode rule in CLAUDE.md "Decisions".
2. Fix the failing origin-check test in `src/server/app.ts` / `tests/api.test.ts` (non-GET with an `Origin` that differs from `Host` must get 403).
3. Review what the interrupted API agent left: every route in `src/shared/api.ts` exists in `src/server/routes/*`; `index.ts` has the time-zone warning and the no-password-on-public-host refusal; `cli/demo.ts` starts the fixture server + SMTP sink.
4. Review the interrupted web agent's work: fill gaps against the route list in `src/shared/api.ts`; add `src/web/public/manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png` (render with the pre-installed Playwright).
5. Move `smtp-server` to `dependencies` (demo mode needs it at runtime) or keep the dynamic import with a clear message — decide by checking `cli/demo.ts`.
6. `npm run build` → `npm start` works; `dist/web` served with SPA fallback.

Exit: build succeeds, all tests green, nothing uncommitted.

## Phase 2 — Verify end to end in demo mode (sandbox)
1. `npm run demo`: first run completes; dashboard shows invented notices, DEMO banner visible.
2. Playwright walkthrough (script in scratchpad) at 1280×800 and 390×844, light + dark: every route loads, no console errors, no horizontal scroll. Look at screenshots and fix.
3. Golden path by hand in the browser: fill profile → upload a document → open "Yard Maintenance Services" → tick checklist → Send → mail captured by the demo sink with the package PDF; portal bid → download package → Mark as submitted → Won.
4. Guardrail checks in the UI: auto mode needs the acknowledgement tick; second Send refused; closed opportunity cannot be sent.
5. API integration test against the real pipeline on fixtures (not only the fake) — one test file, ⇉ can run alongside step 2.
6. Fix the earlier-noted gaps: `Application` DTO has no `remindedAt` (add or drop); closing-date-changed event has no test.

Exit: demo golden path works in a real browser; screenshots reviewed.

## Phase 3 — Hardening for beta
1. ⇉ Security pass (`/security-review`): auth/session cookie, login lockout, CSRF origin check, upload limits + filename sanitising, file-store path safety, SMTP password never in API responses, CSP headers.
2. ⇉ Reliability: crash mid-send → `failed`, never re-sent (already tested); database backup note; run log retention (events/runs pruning after e.g. 180 days).
3. Time zone: confirm the startup warning fires on old tz data; document "keep Node 22.x updated".
4. Docker: `docker build` and run with `APP_PASSWORD`, volume `/data`; health check route (`GET /api/health` → 200) for hosting platforms.
5. README: final setup, deploy (Docker + Caddy HTTPS example), backup, honest limits, beta feedback section.

Exit: security findings fixed; Docker image runs; README complete.

## Phase 4 — Live-source check (needs network; on the user's machine or a session with the hosts allowed)
The sandbox cannot reach the bid sites. Either:
- the user runs `npm run check-sources` locally and pastes the output, or
- a new cloud environment with these hosts allowed: canadabuys.canada.ca, *.bonfirehub.ca portals (victoria, saanich, centralsaanich, northsaanich, uvic), www.saanich.ca, bid.crd.ca, www.esquimalt.ca, oakbay.ca, www.civicinfo.bc.ca.

For each source: status ok/empty, count plausible, titles and closing dates correct against the website. Fix the readers that are wrong (expect 1–3: Bonfire JSON shape, CivicInfo layout, CRD link pattern). Re-run until all are ok/empty.

Exit: every built-in source reads correctly or is disabled with a note.

## Phase 5 — Beta release
1. Tag `v0.1.0-beta`; open a PR to the default branch with the changelog (only when the user asks).
2. Deploy for the beta company (their computer with `npm start`, or a small VPS/Docker host with HTTPS + `APP_PASSWORD`).
3. Beta configuration: real company profile, documents, SMTP with a test send, mode **prepare** (no automatic sending during beta).
4. Two-week beta checklist: daily dashboard check; record each missed/false-positive notice (title + source) for scoring tweaks; every e-mail submission reviewed before Send; collect UI friction notes.
5. After beta: tune relevance/area rules from the feedback list, decide whether to allow `auto` mode, then `v0.1.0`.

## Verification summary
- `npm test`, `npm run typecheck`, `npm run build` green at every commit.
- Demo golden path in a real browser (Phase 2.3), screenshots reviewed.
- `npm run check-sources` all ok/empty against live sites (Phase 4).
- Docker image starts and refuses to run publicly without `APP_PASSWORD`.

## Decisions needed from the user
- Where the beta runs (own computer vs. hosted) — affects Phase 3.4 / 5.2.
- How to do Phase 4: run `check-sources` themselves, or approve a cloud environment with the bid-site hosts allowed.

## UI design & usability pass (Phases A–F)
Progress: [x] A audit · [x] B foundation · [x] C shell · [x] D pages · [x] E a11y/usability · [~] F verification (Lighthouse not run: not installed)

Result (2026-11-17): spacing/type/shadow tokens; inline SVG icon set (`components/Icon.tsx`); grouped sidebar with icons and live count badges, phone menu as overlay with Esc/scrim; score meter bar; dashboard condensed (top 5 needing attention, top 6 deadlines, setup progress bar, collapsible source list; phone height −40%); opportunities list card with search icon and submission-channel icon; detail score card; application stage strip; application detail with numbered portal steps, checklist progress, "Go to the checklist" jump, sticky save bar when dirty; sticky section pills on Profile and Settings; document drag-and-drop zone; fields no longer stretch to row height; input border contrast raised to ≥ 3:1 in both themes; 404 has an h1; disclosure chevrons.
Verified in demo mode with Playwright: 11 routes × 1280/390 × light/dark — 0 console errors, 0 horizontal overflow, one h1 each, no unnamed controls or unlabeled inputs; keyboard Tab order with visible focus, dialog focus trap + Esc + focus return, phone menu Esc; golden paths (upload → tick checklist → price → Send → submitted → Won; second send refused 409; portal download → Mark as submitted); auto mode cannot be saved without the acknowledgement. Not done: a toast system (the existing `Live` regions cover feedback), Lighthouse.

Beta scope trim (user decision, 2026-11-17): fully automatic mode hidden in the UI (shown only when already saved as `auto`, so it can be switched off); Sources page is on/off + Test + health only (no Add/Edit; Sources.tsx 403 → 197 lines); bid types, keywords, site-reading options and service-area lists folded into collapsed "Advanced" sections (Settings page about half as tall). Server/API support unchanged and still tested. Verified in the browser.

### Phase A — Baseline audit (no code changes)
1. `npm run build && npm run demo` (background, read port from output).
2. Playwright script in scratchpad (per `ui-quality-pass`): every route × 1280/390 × light/dark; log console errors, overflow, h1 count, unlabeled controls, focus visibility.
3. Read the screenshots; write a findings list in the scratchpad grouped by page (visual, usability, accessibility). This list drives Phases C–D.

### Phase B — Design foundation (`styles.css`, `components/`)
1. Add tokens: `--space-1..8` (4–64 px), `--text-xs..2xl`, `--shadow-lg`, `--radius-lg`; dark values where needed. Replace hard-coded px across the stylesheet with tokens.
2. Normalize primitives in CSS: buttons (primary/secondary/quiet/danger, sizes, busy spinner keeps width, 40 px touch on phones), inputs/selects/textarea, cards, chips, tables (sticky header, tabular numbers, row hover), focus ring.
3. Add `components/Icon.tsx`: a small set of inline SVG icons (dashboard, search, file, send, upload, settings, source, activity, calendar, check, alert, external, menu, close), `currentColor`, `aria-hidden`.
4. Add to `ui.tsx`: `ScoreMeter` (number + bar + decision word), `StatCard`, `Toolbar` (search + filters row), `ResponsiveTable` (table on desktop, cards on phones from the same column definition), `Toast` provider/hook (success auto-dismiss, errors stay; built on `Live`).
5. Typecheck + build; screenshot one page to confirm nothing broke.

### Phase C — App shell & navigation (`Layout.tsx`, `App.tsx`)
1. Sidebar with icons, active state, grouped (Work: Dashboard, Opportunities, Applications · Company: Profile, Documents · System: Sources, Settings, Activity).
2. Count badges on Opportunities (new suitable) and Applications (needs input / ready) from the dashboard data already fetched (reuse existing `Dashboard` DTO; no new endpoint unless missing).
3. Phone: top bar with title + menu button, slide-out nav with overlay, Esc/overlay closes, focus returns.
4. Polished DEMO banner and signed-in/sign-out area; `theme-color` meta for both themes.

### Phase D — Page-by-page redesign (one page per commit)
Pattern for every page: PageHeader with one primary action → summary row → Sections; four states (loading skeleton, `Empty` with next action, `ErrorBox` with retry, data); dates via `useFormat()`.
1. **Dashboard** — "Needs you" panel first (needs input, ready to send, closing < 72 h), stat cards, new suitable opportunities list, setup checklist card with progress bar, last check time + source health callout.
2. **Opportunities** — Toolbar (search, decision, source, closing window) in URL params (extend existing `useSearchParams`), default sort soonest-closing suitable, ResponsiveTable with ScoreMeter and closing chips, "Show more".
3. **Opportunity detail** — two-column with sticky side panel (score, decision, key dates, Pursue / Not for us / open notice); reasons as a readable list first, notice text below.
4. **Applications** — grouped queue (Needs input · Ready · Submitted · Closed), filters in URL, needs-action first.
5. **Application detail** (largest, 652 lines) — checklist progress at top; each missing item links to its fix; price input with `inputmode=decimal`; e-mail preview; Send confirm dialog listing recipient/subject/attachments/price; portal flow as numbered steps with Download package + Mark as submitted; sticky bottom action bar on phones. Split into subcomponents in the same folder if it helps readability.
6. **Profile & Settings** — sectioned forms with in-page section nav on desktop, validate on blur, focus first error, "Saved" toast, unsaved-changes warning; automation modes as a radio card group with one-sentence explanations; auto mode keeps its acknowledgement dialog.
7. **Documents** — drag-and-drop upload zone + button, file type/size shown, delete confirmation with the file name.
8. **Sources** — health cards (status chip, last checked, count, message in plain words), Test button with inline result, Add source form in a dialog.
9. **Activity** — timeline grouped by day with icons per event type, filter by type.
10. **Login & 404** — centered card, brand mark, clear error text.

### Phase E — Usability & accessibility hardening
1. Keyboard run on every page (Tab order, visible focus, dialogs trap/restore focus).
2. Check text pairs in both themes for contrast (≥ 4.5:1 body, ≥ 3:1 UI); fix tokens.
3. Copy pass: sentence case, same status words everywhere (Suitable, Needs input, Ready to send, Submitted), disabled buttons explain why.
4. Bundle check from `vite build`; lazy-load ApplicationDetail/Settings if initial JS > ~150 KB gzip (currently 136 KB).

### Phase F — Verification & wrap-up
1. Full `ui-quality-pass`: all routes × 2 widths × 2 themes, zero console errors, no overflow; review screenshots and fix.
2. Golden paths in demo mode via Playwright: profile → upload → pursue → price → Send (demo SMTP sink receives mail with package PDF); portal package → Mark as submitted → Won; guardrails (second Send refused, closed opportunity not sendable, auto mode acknowledgement).
3. Lighthouse on the built app (Chromium `/opt/pw-browsers/chromium --headless --no-sandbox`): Accessibility & Best practices ≥ 90.
4. `npm test`, `npm run typecheck`, `npm run build` green; update `src/web/mock.ts` for any new fields.
5. Update docs/PLAN.md (new "UI pass" section ticked), CLAUDE.md "Done", README screenshots section optional. Commit + push to `ccr-d5d1aeaf-xi4ohg` after each phase/page.

