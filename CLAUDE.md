# Lgbids — project memory

Standalone web app that finds, qualifies and applies to gardening/landscaping bids in Greater Victoria, BC.
Start every session with the `lean-build` skill. Other project skills (`.claude/skills/`): `ui-design-system`, `ux-patterns`, `web-feature`, `ui-quality-pass`, `live-sources`, `release-readiness`.

## Stack & commands
Node >= 22.13, TypeScript (ESM, `.js` import suffixes), Fastify 5, built-in `node:sqlite`, zod 4, cheerio, csv-parse, luxon, nodemailer, pdfkit, unpdf; web UI = React 19 + Vite (in `src/web`, not started). Tests: vitest.
`npm test` · `npm run typecheck` · `npm run build` · `npm start` (dist/server/index.js) · `npm run dev`

## Decisions (do not revisit)
- Live check done 2026-11-17 (Phase 4): Saanich RSS + Esquimalt verified; CanadaBuys (both), all Bonfire portals (robots.txt Disallow) and CivicInfo (Cloudflare challenge) ship turned off with notes; bid.crd.ca is dead (off); Oak Bay moved to www.oakbay.ca, unverified (the user declined adding www.crd.ca / www.oakbay.ca to the cloud environment). Never work around robots.txt or bot checks. BC Bid/Bonfire bids come in through their own alert e-mails (source `email-alerts`, Phase 6): Gmail over IMAP read-only with an app password, or imported .eml; never open the alert links. Sources page must show per-source health + a "Test" action.
- BC Bid has a browser check and CanadaBuys disallows robots, so BC Bid notices are not read automatically (the CanadaBuys reader stays, turned off).
- "Apply": e-mail submissions can be sent (one-click, or automatic if opted in); portal bids (Bonfire, BC Bid, bids&tenders) and hard copy are prepared as a package and the user uploads them. No portal logins, no AI/LLM dependency.
- Automation modes: off | discover | prepare (default) | auto. Auto-send only when: status ready, channel email, address came from the notice, score >= autoSendThreshold, type in autoSendTypes, closing known and outside sendCutoffHours, under dailySendCap, profile + SMTP complete. Mark `sending` before SMTP; never auto-resend a `sending` row after a crash.
- Auto mode waives exactly one checklist item, "I have read the bid documents" (key `documents`); every other required item (forms, site meeting, bond, price) still holds the submission for a person.
- The e-mail cover note is regenerated at send time (if not hand-edited) so it carries the final price and attachments.
- Generated bids state only facts present in the profile.
- Time zones: use the tz database via luxon. BC is UTC-7 year-round since 2026 in current tz data; warn at startup if the runtime still shows UTC-8 for America/Vancouver in January. CanadaBuys zone-less times = Eastern; Bonfire `DateClose` = UTC (both the cautious reading).
- Date-only closings: stored as end of local day, precision `date`; deadlines for sending use start of that day (`closingDeadline`).
- Default host 127.0.0.1; `APP_PASSWORD` enables login; SMTP password never returned by the API.
- Add a PWA manifest (`display: standalone`), no service worker.
- Hosted beta prototype (2026-11-17): `npm run build:prototype` (scripts/prototype.mjs) → `dist/prototype`, static, on Netlify via `netlify.toml`. It is the real UI on `src/web/mock.ts` with `VITE_MOCK=1 VITE_PROTOTYPE=1`: state saved in localStorage (timestamps shifted on restore), "Run now" adds one new sample bid per run, downloads built in the browser (`src/web/prototypePdf.ts`, ICS in mock.ts), feedback via Netlify Forms (`beta-feedback`, static copy in `feedback.html`). Prototype code must stay out of `dist/web`: guard with an inline `import.meta.env.VITE_*` check (a constant imported from another module is not folded). Keep mock sources in step with `DEFAULT_SOURCES`.
- Activity is not in the menu (it is a log, not part of the find → qualify → apply flow); it is linked from Today's "Last check".
- Built-in source start modes: `on`, `off` (off on a new install, stays on once the user turns it on), `blocked` (`forceOff`: switched off at every start-up — robots/bot-check sources only).
- Phone alerts: Telegram or ntfy only (no SMS gateways, no paid services); push failure never fails a run.
- Beta scope (2026-11-17, user decision): the UI hides fully automatic mode (shown only if the saved mode is already `auto`, so the user can switch away), offers no "Add a source"/"Edit" on Sources (on/off, Test, health only; user-added sources can still be deleted), and folds bid types, keywords, site-reading options and the service-area lists into collapsed "Advanced" sections. Server/API support for all of these stays, with its tests. Wave 2 additions (D6, D21): Opportunities offers "Add a bid by hand" and "Paste an alert"; Insights offers one-click "Add to excluded words" with a confirm dialog and Undo.

### Wave 2 decisions (docs/WAVE-2.md §5.1; recommended defaults used, 2026-11-22)
- D2: no "Respect robots.txt" switch or user-agent field; robots.txt is always respected and the user agent is `Lgbids/<version>`.
- D3: Oak Bay ships off until its Test passes. D4 (CRD bids page URL) is still open, so CRD stays off.
- D5: CanadaBuys and bids&tenders alerts are parsed in full; MERX and Biddingo get sender recognition and generic parsing until real samples arrive. D9: zone-less MERX times = Eastern.
- D7: "Who you hear from" is a collapsed, read-only section on Sources (UI moved to v2.1; `/api/coverage` still answers 501).
- D10: service area is strictly Sooke to Sidney: Jordan River, Shirley and Port Renfrew out; Willis Point, Otter Point and East Sooke in; boat-access islands (James, Sidney, Piers) `unknown`.
- D11: bundled-trade notices (janitorial, multi-trade, civil works with sod) go to review with a reason and a lower score, never suitable.
- D12: watched bid = pursued, or an application in needs_input, ready or submitted (copies count). Watched bids get notice re-reads (every 12 h, at most 10 per source per run) and change alerts: one push per change, plus e-mail when "Changes to bids you pursue" is on; `closing_refined` is never alerted.
- D13: awards are recorded for every in-area relevant notice; a parsed award never overwrites a confirmed or manual one, and a company-name match only suggests "won" (the application status never changes by itself).
- D15: no multi-user in v2; per-person recipients (UX-14) move to v3 with accounts.
- D16, D17: closing reminders run on their own 15-minute tick in every automation mode, with their own e-mail switch. Thresholds 72 h and 24 h (`reminderHours`), counted from `closingDeadline`, each sent once per closing instant; only pursued bids and unsent applications (needs_input, ready, failed) that are open, unmuted and have a known closing. Submitted bids get none.
- D18-D21: "Not relevant" also dismisses (one tap, Undo, optional "Tell us why"); "Report a bid Lgbids missed" is feedback only, never a source; Insights is a lazy nav item under "Your company" with a Scoring tab; it may offer "Add to excluded words" (confirm + Undo).
- D22: the prototype posts per-notice feedback to the Netlify form `notice-feedback`.
- D23: no bid-value filter in v2 (v3); filters are score, service and place.
- D24: secrets stay plain text in SQLite, data files 0600 and folders 0700, with optional env overlays (`SMTP_*`, `ALERT_IMAP_PASS`, `TELEGRAM_TOKEN`, `NTFY_TOKEN`); backups contain secrets and the docs say so.
- D25: the v2 beta runs on the owner's computer; Docker is checked in CI only.
- D29: if 2.2 live results are not back, tag `v0.2.0-beta` with honest statuses (unverified sources off) and ship 2.2 as `v0.2.1-beta`.
- D30: accessibility-tree snapshots would block merges and pixel diffs run in CI only, non-blocking (TST-6 itself is cut, so none exist yet).
- D31: Node floor stays >= 22.13; a CI job runs 22.13.0 and skips winter tz assertions when the tz data still shows UTC-8.
- D32: corpus gate (`npm run eval -- --check`): pinned rows pass and metrics may not drop; the v2 exit needs suitable recall >= 0.95 and precision >= 0.70.
- FLAG-1 (D14) not approved: an addendum adds no checklist item and does not hold auto-send.
- Lean cuts (§8.9): UX-14 recipients and the UX-12 Insights Results tab → v3; the COV-14 "Who you hear from" UI → v2.1; dropped: the MAT-13 tuning CLI, TST-6, TST-9, UX-17 award extras, OPS-10 log rotation and OPS-8 daily snapshots (the pre-migration snapshot and backup CLI stay).

### Wave 3 decisions (docs/WAVE-3.md §5.1-5.2; user answers 2026-11-23)
- Every §5.1 recommended default (D40-D85) is used; the full six-lane plan, not the lean option. Highlights: accounts add `owner` and `estimator`; `APP_PASSWORD` still enables login and signs in the owner; only the owner presses Send and edits the profile, settings and sources (D55-D57); calendar sync is CalDAV only (D65); `undici` becomes a direct dependency to pin connections to the checked address (D73); `wave3/*` lane branches are pushed after each green package (D82).
- Approved flags (built in the 3.3 fix pass, not in the 3.1 lanes): FLAG-3, an insurance shortfall, a bond above `bondingLimit`, or a missing or expired WorkSafeBC letter becomes a *required* checklist item that holds the submission (auto mode still waives only `documents`); FLAG-4, push and e-mail reminders 72 h and 24 h before a mandatory site meeting, deduped per meeting instant, in addition to D16/D17; FLAG-9, auto-send also requires that the last checklist tick or price edit was made by the owner, not an estimator.
- Not approved: FLAG-2 (re-reading addenda changes required items), FLAG-5 (encrypted secrets), FLAG-6 (`CALDAV_PASS` overlay), FLAG-7 (moving the live install to a VPS), FLAG-8 (log file rotation).
- Price estimates are suggestions only: nothing fills the price or ticks "Price entered and checked" by itself, and internal rates, costs and scorecard data never reach the buyer.

## Done (613 tests passing; demo verified in a browser)
- Wave 2 (v0.2.0-beta, 2026-11-22): 2.0, 2.1 and the 2.3 integration, review fixes and contract requests are done; details in CHANGELOG.md, open items in docs/WAVE-2-STATUS.md. `npm run verify` / `verify:full` are the gates; `npm run backup` / `restore`, `live-check`, `eval`.
- v1 build-out from the uploaded bid-scanner plan (2026-11-21): new built-in sources Sooke, Langford, Colwood, View Royal, Sidney (start off, unverified — sandbox cannot reach them); per-source "layout may have changed" warning (`sources/health.ts`, migration v2, shown on Sources + in the digest; never for incremental sources like `email-alerts`); phone push alerts via Telegram or ntfy (`pipeline/push.ts`, Settings → Phone alerts, tokens write-only); CSV export `GET /api/opportunities.csv` (shared `src/shared/csv.ts`, BOM, formula-injection guard); double-click launchers + `npm run app` (`scripts/launch.mjs`); CI (`.github/workflows/ci.yml`). Roadmap: docs/ROADMAP.md.
- Everything in docs/PLAN.md phases 1–3. App builds, runs, and works end to end in demo mode.
- UI design & usability pass (docs/PLAN.md, phases A–F): tokens, icons, nav badges, redesigned pages; verified in the browser (light/dark, 1280/390, keyboard, golden paths).
- UI pass 2 (docs/PLAN.md, phases 1–6): first-run steps leading to the alert inbox, new-since-last-visit, filters, quick decisions with Undo toasts, per-bid calendar, application autosave/step bar/preview, Help + glossary + score reasons, theme choice, skeletons, lazy loading, compressed/cached assets. axe 0 violations; Lighthouse mobile 94–96 / 100 / 100.
- Hosted beta prototype for Netlify (see Decisions); golden path, downloads, persistence, feedback and axe (0 violations) checked against a local stand-in. Fixed: application price lost when a checklist box was ticked within the 1.5 s autosave delay; Vite dev proxy swallowed `/api.ts`.
- zod runs jitless in the browser (`src/shared/zodConfig.ts`, imported first by schemas.ts) because the CSP forbids eval.
- `src/shared/schemas.ts` — all zod schemas + DTO types (Profile, AutomationSettings, EmailSettings, RegionSettings, SourceConfig/Record, Opportunity, Application, Analysis, Requirement, RunRecord, Dashboard...).
- `src/server/util/text.ts`, `util/dates.ts` (parseDate, findDates, findClosingDate, closingDeadline, formatLocal, nowIso).
- `src/server/matching/` — relevance.ts (lexicon, masks, services, mightBeRelevant, DEFAULT_SEARCH_QUERIES), geo.ts (defaultRegion, assessArea, mightBeLocal, organizationKey), notice.ts (detectNoticeType, extractReference, referenceKey, titleKey), requirements.ts (extractFacts, detectSubmission, buildRequirements), analyse.ts (analyse -> score, decision, Analysis, facts).
- `src/server/db/database.ts` — Database wrapper + full schema migration (settings, sources, opportunities, applications, application_files, documents, runs, events, sessions).
- `src/server/http/` — client.ts (HttpClient: robots, per-host delay, retries, size cap, blocked detection), robots.ts.
- `src/server/sources/` — types.ts, extract.ts (extractListing, extractDetail, parseFeed, labelledFields), connectors (canadabuysCsv, canadabuysSearch, bonfire, web = rss + htmlList), registry.ts (DEFAULT_SOURCES, connectorFor, listSource).
- `src/server/demo/` — fixtures.ts + server.ts: invented sample sites (all e-mails `.example`), dates relative to now.
- Tests: tests/dates, matching, connectors.

## Remaining work
Wave 2 is left with user checks (2.2) and the release (2.4): see docs/WAVE-2-STATUS.md. Plan: docs/WAVE-2.md (lean mode §8.9). Older phases: docs/PLAN.md.

## Conventions
- Token efficiency (user rule, 2026-11-21): always choose the cheapest approach that keeps quality. Do small tasks inline; use workflows only for real multi-lane work, with few agents (scout/build lanes + one verify; skip separate critic/fix agents unless the change is risky), tight prompts, read-only scouts returning structured data, `budget` guards on every loop, and no re-reading of files already summarised.
- Pure logic in `matching/` and `util/`, no I/O; connectors never throw out of `listSource`.
- DB columns snake_case, API/DTO camelCase; JSON columns stored as text.
- Comments explain why, in plain language; user-facing strings are full sentences.

## Open problems
(none)
