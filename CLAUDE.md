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
- Beta scope (2026-11-17, user decision): the UI hides fully automatic mode (shown only if the saved mode is already `auto`, so the user can switch away), offers no "Add a source"/"Edit" on Sources (on/off, Test, health only; user-added sources can still be deleted), and folds bid types, keywords, site-reading options and the service-area lists into collapsed "Advanced" sections. Server/API support for all of these stays, with its tests.

## Done (288 tests passing; demo verified in a browser)
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
Next wave: docs/WAVE-2.md (v2 plan: lanes, tasks, user decisions, workflow outline, budget). Older phases: docs/PLAN.md.

## Conventions
- Token efficiency (user rule, 2026-11-21): always choose the cheapest approach that keeps quality. Do small tasks inline; use workflows only for real multi-lane work, with few agents (scout/build lanes + one verify; skip separate critic/fix agents unless the change is risky), tight prompts, read-only scouts returning structured data, `budget` guards on every loop, and no re-reading of files already summarised.
- Pure logic in `matching/` and `util/`, no I/O; connectors never throw out of `listSource`.
- DB columns snake_case, API/DTO camelCase; JSON columns stored as text.
- Comments explain why, in plain language; user-facing strings are full sentences.

## Open problems
(none)
