# Changelog

All notable changes to Lgbids are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.2.0-beta] — Unreleased

Wave 2: more bids, fewer misses, and a beta you can run every day. The plan is in docs/WAVE-2.md (lean mode) and the open items are in docs/WAVE-2-STATUS.md.

### Added

**Coverage and alerts**
- Alert e-mails from CanadaBuys, bids&tenders, MERX and Biddingo are recognised as well as BC Bid and Bonfire, each with its own time-zone reading. CanadaBuys and bids&tenders are parsed in full; MERX and Biddingo use generic parsing until real samples arrive.
- The alert inbox remembers where it stopped, searches Gmail by sender, supports STARTTLS, and "Test connection" shows how many alert e-mails it found per sender.
- Alert e-mails that hold no notice are kept as "not recognised" for a bug report instead of being filed as read. An imported `.eml` file is read at once, and Sources says what it found.
- Opportunities has "Add a bid by hand" and "Paste an alert". A pasted alert merges with the same notice when its e-mail arrives later. Lgbids never opens the links in an alert.
- The page reader picks up posted documents, titles in headings and portal notes, and can explain what it read.
- A buyer registry records who posts where. Fixes to the built-in sources now reach existing installs unless the user edited the source.
- `npm run live-check` checks the real bid sites and, with `--alerts` or `--eml`, a real alert inbox, on your own computer. It writes a short report and a scrubbed bundle to send back, and never writes the app database.

**Matching**
- A labelled corpus and `npm run eval` measure how well bids are scored; CI fails if pinned rows break or the scores drop.
- Every score has a rule trace with reason codes, so "why is this suitable?" has an exact answer.
- Lexicon tuning: synthetic turf and equipment purchases are no longer landscaping work, and bundled-trade notices (janitorial, multi-trade, civil works with sod) go to review with a reason and a lower score.
- The service area is strictly Sooke to Sidney, with a street guard for place names that exist elsewhere and a few new local places.
- Duplicate detection uses organisation aliases, refuses to match on a missing closing date, and no longer joins an open notice to a finished one.

**Bid lifecycle: changes, re-reads and awards**
- Each notice keeps a change log (closing moved or added, new documents and addenda, status, description). A change seen on a copy of the notice on another site is carried to the main bid.
- Notice pages of watched bids (pursued, or with an unsent or submitted application) are read again every 12 hours, at most 10 per source per run.
- A bid whose closing moves into the future after it closed is opened again, unless it was cancelled or awarded.
- Award and result notices are linked to the original bid and record the winner, amount and date as a suggested award. A parsed award never overwrites one you confirmed or entered.
- Undated alert bids and pursued bids are never closed automatically.

**Daily loop**
- Closing reminders 72 and 24 hours before the deadline, by phone and optionally by e-mail, for pursued bids and unsent applications. They run in every automation mode.
- Change alerts: one phone alert per change to a watched bid, plus an e-mail when "Changes to bids you pursue" is on. Bid pages have a "What changed" list, and lists show a "Changed" chip.
- Feedback on scores: "Not relevant" (which also dismisses the bid, with Undo and "Tell us why"), "Missed this one", and "Report a bid Lgbids missed". Feedback can be downloaded as CSV.
- Insights → Scoring shows where the scoring went wrong and can add a word to the excluded words in one click, with a confirm dialog and Undo.
- Won and lost results: "Record the result" on an application, an award section on the bid, and award columns in the CSV export.
- Saved searches and filters by score, service and place on Opportunities.
- First-run steps include phone alerts; result corrections can be undone.
- The hosted prototype sends per-notice feedback to a Netlify form, `notice-feedback`.

**Ops and security**
- Outgoing reads check robots.txt on every redirect, treat an unreadable robots.txt as "disallow", refuse private and local addresses (including NAT64, 6to4 and site-local IPv6), and send a fixed user agent.
- The server answers only to allowed host names (`ALLOWED_HOSTS`), caps sign-in attempts, stores sessions as hashes, signs everyone out when `APP_PASSWORD` changes, and decides sign-in on the matched route, so percent-encoded paths cannot skip it. It sends HSTS over HTTPS, a Permissions-Policy and COOP, and downloads are sandboxed.
- Mail logins to remote servers require TLS, and a saved password is never carried over to a new host or user. IMAP, Telegram and ntfy secrets can come from environment variables.
- The data folder is private (0700, files 0600), and only one copy of Lgbids runs at a time.
- `npm run backup` and `npm run restore`; a snapshot is taken before each database migration, and a database from a newer version is refused.
- Graceful shutdown waits up to 25 seconds for a running check, and a check missed while the computer slept runs as soon as it wakes.
- The Docker image owns its `/data` folder and keeps secrets and local files out of the build.

**Verification**
- Playwright end-to-end tests for the demo and the prototype, golden paths, a prototype smoke test, and axe accessibility and keyboard checks in light and dark at phone and desktop widths.
- A clock and time-zone matrix (summer and winter), start-up and CLI tests, a bundle guard with CSP parity, and a coverage ratchet.
- `npm run verify` and `npm run verify:full`, and CI jobs for checks, e2e, the Node 22.13 floor, a production smoke test, Docker and an audit.
- 613 automated tests.

### Changed
- Oak Bay ships turned off until its Test passes.
- The summary e-mail starts with changes to the bids you are pursuing and no longer lists them again as new.
- "Dismiss" on a bid page is now "Not for us", and its toast offers Undo and "Tell us why".
- Award columns are always part of the CSV export.

### Fixed
- The phone menu no longer slides in when the system asks for reduced motion.

### Removed
- The "Respect robots.txt" switch and the user-agent field. Lgbids always respects robots.txt.

### Known gaps
- The live sites and a real alert inbox have not been checked from the build environment. Parsing for CanadaBuys, bids&tenders, MERX and Biddingo alerts is tested on invented samples only.
- The CRD source stays off until its current bids page is known. Oak Bay, Sooke, Langford, Colwood, View Royal and Sidney are unverified.
- Outgoing reads do not pin the connection to the address that was checked, so DNS rebinding is still possible.
- "Who you hear from" on Sources is not built: `/api/coverage` still answers "Not built yet". So does `/api/status`, and `/api/health` does not check the database yet.
- A draft that expired when its bid closed stays expired if an extension opens the bid again; reopen it by hand.
- If the phone alert for a change fails after the summary e-mail already listed it, that phone alert is not sent again.
- An addendum does not add a checklist item or hold automatic sending (FLAG-1 was not approved).
- Moved to later versions: per-person alert recipients, the Insights Results tab and a bid-value filter (v3); the "Who you hear from" table (v2.1). Cut: the tuning command line, pixel visual tests, extra award views, log rotation and daily snapshots.
- CI has not run on GitHub yet, so the Docker and Node-floor jobs are unproven. Reminders and change alerts have not been checked on a real phone.

## [0.1.0] — 2026-11-21

First version.

### Added
- Reads the Saanich feed, the Esquimalt page and BC Bid and Bonfire alert e-mails (Gmail over IMAP, read-only, or imported `.eml`); sources that block automated reading ship off with a note.
- Scores each notice for work type, area, status, services and requirements, with reasons.
- Drafts a submission package and checklist from the company profile; sends e-mail submissions when you press Send, and prepares portal and hard-copy packages for upload.
- Automation modes (off, discover, prepare, auto) with strict auto-send rules.
- Sources page with health and Test; phone alerts by Telegram or ntfy; CSV export; calendar files.
- Double-click launchers and `npm run app`, Docker, a demo mode with invented sample sites, and a hosted prototype for testers on Netlify.
