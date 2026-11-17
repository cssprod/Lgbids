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

**Done 2026-11-17.** Before → after:
- Saanich RSS: ok but no closing dates/references → ok, all 10 with closing + reference (detail labels on separate lines; `findClosingDate` was skipping "Closing" after a "Posted Date"). Regression test: `tests/fixtures/saanich-notice.html`.
- Esquimalt: ok → ok (verified titles, types, closing, statuses, documents by hand).
- CanadaBuys BC Bid + federal CSV, Bonfire Victoria/Saanich/Central Saanich/North Saanich/UVic: blocked (robots.txt `User-agent: * Disallow: /`) → turned off with a note.
- CivicInfo BC: 403 (Cloudflare challenge) → turned off with a note.
- CRD: 404 (bid.crd.ca dead) → turned off; new page on www.crd.ca not checked (host not allowed in the cloud environment; user declined adding it).
- Oak Bay: DNS → URL moved to www.oakbay.ca; still unverified for the same reason.
- `run-once` on a fresh data dir: 27 notices (Saanich 10, Esquimalt 17), 0 suitable — correct: none is landscaping work. No matching changes needed.
Remaining: check www.crd.ca and www.oakbay.ca from a machine that can reach them.
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


## Phase 6 — Read bid alert e-mails
**Built 2026-11-17 (Gmail, BC Bid, Bonfire):** `sources/alerts/parse.ts` (tolerant reader: notices found by their link, fields from the row/block, table headers as labels, plain text too), `sources/alerts/mailbox.ts` (imapflow, read-only EXAMINE, FROM-filtered search, UID position per mailbox), `connectors/emailAlerts.ts` (inbox + `<dataDir>/alert-inbox/*.eml`, read files move to `read/`, a Test consumes nothing), settings `alertInbox` + routes (`/api/settings/alert-inbox`, `/test`, `/api/alerts/import`), built-in source `email-alerts` (off until the inbox is saved or a file is imported), Settings "Bid alert inbox" with Gmail steps, `.eml` drop zone on Sources, demo seeds one invented alert. Tests: parser (invented samples), pipeline end to end with a fake mailbox, API (password never returned, test messages, import validation). Verified in the browser in demo mode.
**Still open:** (1) parsers checked only against invented alerts — needs 2–3 real BC Bid and Bonfire alerts each (`.eml`, anonymised into `tests/fixtures/`); (2) the IMAP path has not touched a real Gmail account (imap.gmail.com is not reachable from the cloud sandbox) — first real "Test connection" is the check.

### Original proposal
Why: Phase 4 showed BC Bid, CanadaBuys, Bonfire and CivicInfo refuse automated reading, and they carry most Greater Victoria landscaping bids. Each of them e-mails registered vendors about new opportunities. Reading those e-mails is permitted (they are sent to the user), so Lgbids can find those bids again without touching the sites.

### How it works
1. The user turns on the sites' own alerts (BC Bid notifications for landscaping/grounds categories, "follow" on each Bonfire buyer, a saved CanadaBuys search) and has them delivered to — or forwarded by a filter into — one mailbox or folder.
2. A new source kind `email_alerts` reads that folder over IMAP, **read-only** (`EXAMINE`, never marks, moves or deletes mail), only messages newer than the last one it read (UID kept in source `state`), and only from known alert senders.
3. A small parser per sender turns each e-mail into notices (`RawOpportunity`): title, buyer, reference, closing date, link. Unknown senders are skipped and counted in the source's health line.
4. The rest of the pipeline is unchanged: dedupe (by reference/title + buyer), scoring, drafting for approval. The notice link opens the site in the user's browser; Lgbids does not fetch it (those sites refuse robots).

### Pieces
- `src/server/sources/connectors/emailAlerts.ts` — IMAP read via `imapflow`, MIME via `mailparser` (both new runtime deps; no AI). Per-run cap (e.g. 200 messages), size cap, timeouts; never throws out of `listSource`.
- `src/server/sources/alerts/{bcbid,bonfire,canadabuys}.ts` — pure parsers (HTML + text part), each with tests on real alert e-mails trimmed and anonymised to `.example`.
- Settings → "Bid alert inbox": host, port, TLS, user, app password (stored like the SMTP password, never returned by the API), folder, "Test connection" (lists how many alert e-mails it can see). Built-in source "Bid alert e-mails", off until the inbox is set.
- Fallback without IMAP: "Import alert e-mails" on the Sources page — drop `.eml` files (same parsers). Useful for testing and for Outlook.com users.
- Dashboard/Sources: health shows "12 alert e-mails read, 9 notices, 3 skipped (unknown sender)".

### Constraints and risks
- **Mail provider sign-in.** Gmail allows IMAP with an app password (needs 2-step verification; some Workspace admins block it). Outlook.com/Microsoft 365 no longer allow password sign-in for IMAP (OAuth only) — out of scope for the beta; use forwarding to a mailbox that supports app passwords, or the `.eml` import. Recommended: a dedicated mailbox (e.g. bids@yourcompany) that only receives the alerts.
- **Alert formats are unknown until we see real samples.** Each parser needs 2–3 real alert e-mails per site. Alerts may hold only a title and link (no closing date); then the notice is stored with "closing date not stated — check the notice" and scored on title/buyer alone (likely "Needs review" rather than "Suitable").
- **Privacy.** Only alert senders are read; message bodies of other mail are never opened (filter on `FROM` server-side before fetching). Credentials stay on the user's server.

### Effort (estimate)
- IMAP source + settings + test connection + `.eml` import: ~1 day.
- Each sender parser with tests: ~2–3 hours once samples exist (3 senders ≈ 1 day).
- Browser pass + docs: ~half a day.

### Needed from the user before starting
1. Which mail provider the alerts go to (Gmail, Microsoft, other).
2. Which alerts they receive or will set up (BC Bid, Bonfire buyers, CanadaBuys, CivicInfo).
3. 2–3 example alert e-mails per site, saved as `.eml` (personal details can be blanked; they are anonymised before going into tests).

## UI pass 2 — usability (Phases 1–6)
Progress: [x] 1 first-run · [x] 2 daily loop · [x] 3 feedback & forms · [x] 4 help · [x] 5 polish · [x] 6 a11y/perf

### Phase 1 — First-run and setup (highest value)
1. **Setup checklist leads with alerts.** `src/server/dashboard.ts` builds `setup[]` (profile, services, email, documents, run). Add `alerts` ("Connect your bid alert inbox", done = `settings.getAlertInbox().verifiedAt` or any imported alert read) as step 2, linking to `/settings#alerts`. Update `tests/api.test.ts` dashboard expectation.
2. **Welcome screen when nothing is set up** (dashboard `setup` all false and no opportunities): one card on Today — "Three steps to your first bids" (Company profile → Bid alert inbox → Run first check) with big buttons, replacing the empty tiles/lists. Reuse `Section`, `Empty`, `.progress`.
3. **Sources page reorders by usefulness:** "Bid alert e-mails" card first and visually primary; working sources next; turned-off sources grouped under a collapsed "Sites that cannot be read automatically (8)" with their notes. `src/web/pages/Sources.tsx` only.
4. **Dashboard "Bid sites" panel** becomes "Where bids come from": alert inbox status (connected / not set up → link), last alert read, plus working sources; stops listing turned-off ones.

### Phase 2 — Daily loop
1. **"New since your last visit".** Store the last-visit time per browser (localStorage, try/catch, per ux-patterns rule) in `hooks.ts`; Opportunities rows and Today show a "New" chip for `firstSeenAt` after it; nav badge counts new suitable. No server change (`firstSeenAt` already on `Opportunity`).
2. **Opportunities filters:** add closing-window (this week / 2 weeks / any) and source (alerts / Saanich / Esquimalt…) selects next to search, kept in the URL like `view`/`q` (`useSearchParams` already used). Server: extend `/api/opportunities` query with `closingWithinDays` and `source` in `src/server/routes/opportunities.ts` + store query; tests in `tests/api.test.ts`.
3. **Quick decisions from the list:** "Pursue" / "Not for us" buttons on each suitable/review row (same `/decision` endpoint as `OpportunityDetail.tsx`), with an Undo toast (Phase 3.1).
4. **Per-bid calendar link** on opportunity and application detail (`/api/calendar.ics?id=` — check `routes/calendar.ts`; add the filter if missing).

### Phase 3 — Feedback and forms
Done with two deliberate changes: autosave covers the application draft only (Profile saves re-score every bid and would show errors mid-typing, so it keeps Save + sticky bar); the application page got a step bar, letter preview and phone action bar instead of a file split (internal only).
1. **Toast system** (`components/Toast.tsx` + provider in `App.tsx`): success auto-hides after 4 s, errors stay, optional Undo action; announced via one `aria-live` region. Use for save, send, import, decisions. Keep page-level `Live` only where the message must stay next to a field.
2. **Application detail as three steps** (`ApplicationDetail.tsx`, 693 lines → split into `pages/application/{Overview,PriceLetter,Attachments,Submit}.tsx`): a step bar "1 Price & letter · 2 Attachments · 3 Submit" with completion ticks driven by `a.missing`/`a.checklist`; same data and endpoints. Sticky bottom action bar on phones with the one next action.
3. **Autosave drafts** for the application letter/price and Profile (debounced PUT after 1.5 s idle, "Saved" indicator) instead of the explicit Save + unsaved warning; keep `useUnsavedWarning` while a save is pending.
4. **Inline validation**: `Field` gets an `error` prop (`aria-invalid`, `aria-describedby`), first invalid field focused on submit; used on Profile, Settings e-mail/alert inbox, application price/address.
5. **Letter preview**: "Preview as the buyer sees it" toggle rendering the e-mail/cover letter as formatted text next to the editor (no HTML injection — `PlainText`).

### Phase 4 — Help and clarity
1. **Glossary tooltips** for RFQ, ITT, RFP, RFSQ, pre-qualification, bid bond, addenda (`components/Term.tsx`, a `<button>` with an accessible popover); used in notice types and checklist labels.
2. **Help page** (`/help`, nav under System): getting started, how alerts work (Gmail steps), what "Suitable" means and how scores work, what Lgbids never does (send without approval, log in to portals, invent facts). Copy from README sections.
3. **Score explanation** on hover/tap of the score meter: top 3 reasons from `analysis.reasons`.

### Phase 5 — Look and polish
Done: theme choice (System/Light/Dark, Settings → Appearance), skeleton placeholders on Today/Opportunities/Applications, leaf mark on empty states, login spacing. Not done: PWA “Add to Home Screen” hint and a money/date formatting sweep (both minor; existing screens already use formatMoney and relative + absolute closing dates).
1. **Manual light/dark toggle** (System / Light / Dark in Settings → Appearance): `data-theme` on `<html>`, localStorage, tokens duplicated under `:root[data-theme=dark]` per ui-design-system; `theme-color` meta updated.
2. **Skeleton loaders** for list and detail pages (replace spinner-only `Loading` where layout is known) to stop content jumping.
3. **Empty-state illustrations**: small inline SVG line drawings (leaf/inbox/calendar) in `Empty`, `currentColor`, decorative.
4. **Login page and 404** with the brand mark and the same card style; PWA "Add to Home Screen" hint on phones (one-time, dismissible).
5. **Typography/number details**: consistent money formatting (`formatMoney`) everywhere prices show; relative + absolute dates everywhere closing shows.

### Phase 6 — Accessibility, performance, verification
Done 2026-11-17. axe-core 4.10: 0 violations on 11 routes × 1280/390 × light/dark (fixed Profile heading order and hidden rate labels). Lighthouse 12 (mobile, throttled): Performance 94–96, Accessibility 100, Best practices 100 on Today, Opportunities and Help. Fixes: lazy-loaded heavier pages (initial JS ≈ 128 KB gzip), build writes .br/.gz served via preCompressed (main script 68 KB on the wire, was 257 KB), hashed assets cached a year; phone layout shift 0.174 → 0 (`.app` grid rows `auto 1fr`); zod's eval probe moved to `src/shared/zodConfig.ts` so the CSP console error does not return when chunks reorder. Keyboard: toast Undo reachable and works, step links, theme radios with arrow keys, dialogs and phone menu.
1. **axe-core pass** (load from cdnjs in the Playwright script when reachable; otherwise the existing DOM checks) on every route, light/dark, 390/1280; fix serious/critical.
2. **Lighthouse** with the pre-installed Chromium (`/opt/pw-browsers/chromium --headless --no-sandbox`) via `npx lighthouse` if installable; targets ≥ 90 Accessibility/Best practices.
3. **Lazy-load** heavier pages (`ApplicationDetail`, `Settings`, `Profile`, `Help`) with `React.lazy` + `Suspense` (skeleton fallback); keep initial JS < 150 KB gzip.
4. Keyboard and screen-reader smoke test of new components (toast, step bar, tooltips, toggle).

### Order and size
Phase 1 (~1 day) → Phase 2 (~1.5 days) → Phase 3 (~2 days) → Phase 4 (~1 day) → Phase 5 (~1 day) → Phase 6 (~0.5 day). Each numbered item is one commit, pushed to `ccr-d5d1aeaf-xi4ohg`; docs/PLAN.md gets a "UI pass 2" progress line per phase.

