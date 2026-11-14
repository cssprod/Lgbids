# Lgbids — project memory

Standalone web app that finds, qualifies and applies to gardening/landscaping bids in Greater Victoria, BC.
Start every session with the `lean-build` skill.

## Stack & commands
Node >= 22.13, TypeScript (ESM, `.js` import suffixes), Fastify 5, built-in `node:sqlite`, zod 4, cheerio, csv-parse, luxon, nodemailer, pdfkit, unpdf; web UI = React 19 + Vite (in `src/web`, not started). Tests: vitest.
`npm test` · `npm run typecheck` · `npm run build` · `npm start` (dist/server/index.js) · `npm run dev`

## Decisions (do not revisit)
- Network access to the real bid sites was declined in the cloud sandbox: connectors are tolerant, fixture-tested, and UNVERIFIED against live sites. Say so in README; first real run is the test. Sources page must show per-source health + a "Test" action.
- BC Bid has a browser check, so it is read via the CanadaBuys mirror (notice ids starting `bc`).
- "Apply": e-mail submissions can be sent (one-click, or automatic if opted in); portal bids (Bonfire, BC Bid, bids&tenders) and hard copy are prepared as a package and the user uploads them. No portal logins, no AI/LLM dependency.
- Automation modes: off | discover | prepare (default) | auto. Auto-send only when: status ready, channel email, address came from the notice, score >= autoSendThreshold, type in autoSendTypes, closing known and outside sendCutoffHours, under dailySendCap, profile + SMTP complete. Mark `sending` before SMTP; never auto-resend a `sending` row after a crash.
- Generated bids state only facts present in the profile.
- Time zones: use the tz database via luxon. BC is UTC-7 year-round since 2026 in current tz data; warn at startup if the runtime still shows UTC-8 for America/Vancouver in January. CanadaBuys zone-less times = Eastern; Bonfire `DateClose` = UTC (both the cautious reading).
- Date-only closings: stored as end of local day, precision `date`; deadlines for sending use start of that day (`closingDeadline`).
- Default host 127.0.0.1; `APP_PASSWORD` enables login; SMTP password never returned by the API.
- Add a PWA manifest (`display: standalone`), no service worker.

## Done (117 tests passing)
- `src/shared/schemas.ts` — all zod schemas + DTO types (Profile, AutomationSettings, EmailSettings, RegionSettings, SourceConfig/Record, Opportunity, Application, Analysis, Requirement, RunRecord, Dashboard...).
- `src/server/util/text.ts`, `util/dates.ts` (parseDate, findDates, findClosingDate, closingDeadline, formatLocal, nowIso).
- `src/server/matching/` — relevance.ts (lexicon, masks, services, mightBeRelevant, DEFAULT_SEARCH_QUERIES), geo.ts (defaultRegion, assessArea, mightBeLocal, organizationKey), notice.ts (detectNoticeType, extractReference, referenceKey, titleKey), requirements.ts (extractFacts, detectSubmission, buildRequirements), analyse.ts (analyse -> score, decision, Analysis, facts).
- `src/server/db/database.ts` — Database wrapper + full schema migration (settings, sources, opportunities, applications, application_files, documents, runs, events, sessions).
- `src/server/http/` — client.ts (HttpClient: robots, per-host delay, retries, size cap, blocked detection), robots.ts.
- `src/server/sources/` — types.ts, extract.ts (extractListing, extractDetail, parseFeed, labelledFields), connectors (canadabuysCsv, canadabuysSearch, bonfire, web = rss + htmlList), registry.ts (DEFAULT_SOURCES, connectorFor, listSource).
- `src/server/demo/` — fixtures.ts + server.ts: invented sample sites (all e-mails `.example`), dates relative to now.
- Tests: tests/dates, matching, connectors.

## Remaining work (in order)
- [ ] `db/store.ts`: repositories + row mappers; opportunity upsert (keep richer detail fields, detect closing-date change, content hash), cross-source dedupe via `ref_key`/`title_key` (`orgKey:refKey`, `orgKey:titleKey`, closings within 36 h) setting `duplicate_of` and merging empty fields.
- [ ] `settings.ts`: typed get/set with defaults (region default = `defaultRegion()`); clear every source `state` when region/automation settings change.
- [ ] `pipeline/run.ts`: per enabled source listSource -> upsert -> detail fetch (new items; cap ~40/source/run; national sources only for plausible rows) -> read linked PDFs with unpdf for relevant+local items (max 3 docs, 15 MB, never fatal) -> analyse -> draft applications for `suitable` (or user `pursue`) when mode >= prepare -> auto-send when mode = auto -> close past-deadline opportunities, expire unsent applications -> run stats + events. `bcSource = raw.bcSource || config.localBuyer || config.bcOnly`. Mutex against overlapping runs.
- [ ] `applications/`: draft.ts (channel, to, subject, body, checklist, missing[] -> needs_input/ready), templates.ts (cover letter + service paragraphs from profile only), pdf.ts (pdfkit package: letter, profile, services, references, rates, compliance), readiness rules (price needed unless pricing is rates/none; forms, site meeting, bond are required checklist items).
- [ ] `submission/email.ts`: nodemailer transport from settings/env, send application (package PDF + library docs + uploaded files, bcc self), test e-mail; idempotent status handling.
- [ ] `pipeline/scheduler.ts` (interval timer, next-run time) and `pipeline/notify.ts` (digest of new suitable items, needs-input, deadline reminders).
- [ ] `config.ts`, `app.ts` (Fastify factory), `routes/` (dashboard, opportunities, applications incl. send/mark-submitted/files/package PDF, profile, settings, email test, sources CRUD + test, documents upload, runs, events, calendar.ics, auth), `index.ts` (startup tz warning).
- [ ] CLI: `cli/checkSources.ts`, `cli/runOnce.ts`, `cli/demo.ts` (fixture server + local SMTP sink + separate `data-demo` dir + visible DEMO banner), `scripts/dev.mjs`.
- [ ] Web UI: Dashboard, Opportunities (list/detail with reasons), Applications (queue/detail, approve & send, download package, mark submitted), Company profile, Documents, Sources (health, test, add), Settings, Activity; manifest + icons.
- [ ] Integration tests (pipeline on fixtures, SMTP via smtp-server, API via fastify.inject), then a Playwright pass over the UI in demo mode.
- [ ] README (setup, deploy, honest limits), Dockerfile, final commit + push.

## Conventions
- Pure logic in `matching/` and `util/`, no I/O; connectors never throw out of `listSource`.
- DB columns snake_case, API/DTO camelCase; JSON columns stored as text.
- Comments explain why, in plain language; user-facing strings are full sentences.

## Open problems
(none)
