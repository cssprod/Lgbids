---
name: release-readiness
description: Final-stage checklist to take Lgbids from beta to a finished, deployable product — security, reliability, performance, accessibility, docs, Docker/deploy, versioning and handover. Use when asked to finalise, ship, release, prepare for production, or "is it done?".
---

# Release readiness

Work through each block; record pass/fail with evidence (command output, screenshot) in the final report. Fix failures or list them as known limits — never mark unverified items as done.

## 1. Build & tests
- Clean install: `rm -rf node_modules dist && npm ci && npm run build` succeeds with no warnings worth fixing.
- `npm test` and `npm run typecheck` green. Integration tests cover pipeline on fixtures, SMTP via smtp-server, API via `fastify.inject`.
- `npm audit --omit=dev`: no high/critical; justify any left.

## 2. Security
- Run the `security-review` skill on the branch diff.
- `APP_PASSWORD` login: secure, HttpOnly, SameSite cookie; lockout after repeated failures; logout clears the session.
- Refuses to listen on a public host without `APP_PASSWORD` (default host 127.0.0.1).
- CSRF origin check on non-GET; CSP and other security headers set; uploads size-limited, filenames sanitised, file store path-safe.
- Secrets: SMTP password never returned by any route or logged; `.env` not committed; no real e-mail addresses in fixtures.

## 3. Reliability
- Crash mid-send leaves `sending`/`failed`, never resent automatically.
- Scheduler survives a failing source; overlapping runs prevented; run/event pruning works.
- Startup time-zone warning works; DB backup/restore documented and tried once (copy the data dir while stopped, restore, start).
- `GET /api/health` → 200.

## 4. UX & visual polish
- Run `ui-quality-pass` on every route: no console errors, no horizontal scroll, light + dark, 390 px + 1280 px, keyboard path, four states per view.
- Golden paths in demo mode pass (e-mail send captured; portal package → submitted → won).
- Copy pass: sentence case, full sentences, consistent status words, no placeholder text.

## 5. Performance
- Web bundle gzip size noted (`vite build` output); lazy-load pages if initial JS > ~150 KB gzip.
- Dashboard API responds < 200 ms on a data dir with ~2,000 opportunities (generate with a scratch script).
- Lighthouse (Chromium at `/opt/pw-browsers/chromium`, `--headless --no-sandbox`) on the built app: Performance / Accessibility / Best practices ≥ 90; fix what is cheap.

## 6. Deploy
- `docker build` and `docker run` with `APP_PASSWORD`, volume `/data`, health check passes; image runs as non-root.
- README deploy section (Docker + Caddy HTTPS) tested as written, line by line.
- PWA manifest loads and the app installs ("Add to Home Screen") on a phone-sized viewport.

## 7. Docs & handover
- README: what it does, setup, configuration (env vars table), demo mode, deploy, backup, updating Node (tz data), honest limits — including exactly which sources were verified live (Phase 4) and which are unverified/disabled.
- CHANGELOG entry and version bump in `package.json` (semver; 1.0.0 only when Phase 4 + 5 exits are met).
- CLAUDE.md and docs/PLAN.md reflect the final state; "Open problems" accurate.
- Commit, push to the session branch; open a PR only if the user asks.

## Report
Short table: area | status | evidence/notes, then the list of known limits.
