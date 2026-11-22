# Wave 2 status (2026-11-22)

Branch `ccr-707adaf0-joblwh` holds all of Wave 2 that can be built here. `npm run verify:full` is the gate (613 tests). Plan: docs/WAVE-2.md, lean mode (section 8.9). What changed for users: CHANGELOG.md. Decisions used: CLAUDE.md, "Wave 2 decisions".

## 2.1 — done
- Lane C: C-1 (COV-3, COV-4, COV-7), C-2 (COV-6, COV-12, COV-8, COV-9), C-3 (COV-10, COV-15), C-4 (COV-5 live-check kit).
- Lane M: M-1 (MAT-2, MAT-3, MAT-11, COV-17, MAT-6), M-2 (MAT-4, MAT-5), M-3 (MAT-8, MAT-7), M-4 (MAT-9, MAT-16).
- Lane P: P-1 (UX-1 to UX-5, COV-16), P-2 (UX-7, MAT-10, MAT-15), P-3 (MAT-12, UX-9, UX-10; the MAT-13 CLI is cut), P-4 (UX-11, UX-13).
- Lane O: O-1 (COV-2, OPS-2, OPS-3, OPS-4), O-2 (OPS-5, OPS-7, OPS-8, OPS-9, OPS-11, TST-13).
- Lane V: TST-2, TST-3, TST-4, TST-5, TST-10, OPS-12 (CI written; not yet run on GitHub).

## 2.3 — done
- **Merge**: lanes C, M, P, O and V merged; the frozen 501-stub list was trimmed to the routes still unbuilt (`/api/coverage`, `/api/recipients*` and `/api/status`).
- **Review findings fixed**: sign-in is decided on the matched route, so encoded `/%61pi` paths are refused; a closed bid reopens when its closing moves into the future; changes are listed in the summary only when change e-mails are on, and never e-mailed twice; title-only award links refuse a different reference and end a bid only once its closing passed; NAT64, 6to4 and `fec0::/10` addresses are refused.
- **Skeptic findings**: F1 (a slow copy reopened an awarded or cancelled bid), F2 (a changed bid later listed as new), F3 (a change e-mailed again after a failed push) and F4 (last year's award linked by title to an open bid) are fixed, each with a test that failed before the fix. F5 (a draft stays expired when an extension reopens its bid) is low severity and not fixed; it is listed under Known gaps in CHANGELOG.md.
- **Contract requests applied**: `recomputeKeys` at start-up; `allowPrivate` in the pipeline test helper and connector tests, and `legacyTestDefaults` removed; alert inbox Test returns per-sender counts and the UI shows them; lifecycle methods in the Store contract; `AreaResult.rule` required; dark danger-button contrast (a11y waiver list empty); `.table-scroll`; `npm run live-check`, plus `npm run backup` and `npm run restore` (the CLIs existed without package scripts); D2 fields removed from the automation schema; the `.eml` import shows what it found; `resultSuggestion` in the shared Application type; award columns always in the CSV; one toast with Undo and "Tell us why"; bids added by hand keep their submission method when re-scored; the static `notice-feedback` Netlify form (UX-16).
- **Contract requests not applied, with reasons**: the stored layout warning keeps its v1 wording, because the UI rebuilds the v2 text from the count (R25); no `reissueOf` field, because the `reissue` event row is enough for the beta; `/api/coverage` still answers 501, because the COV-14 UI moved to v2.1; per-person recipients (UX-14) and the Insights Results tab (UX-12) moved to v3; OPS-10 was in no lean work package, so `/api/status` still answers 501 and `/api/health` does not check the database yet (a v2.1 candidate); `linkDuplicate` still returns only the canonical id, and the store still files changes under the running run (both optional).
- **Final gate**: `npm run verify:full` is green: 613 vitest tests (also shuffled), both builds, the bundle check, coverage, and 46 Playwright tests (14 skipped by project). The first run had two e2e failures: the golden-path "Won" step predated the UX-11 result dialog (test updated), and the phone menu still ran its drop-in animation under reduced motion, so axe sometimes measured the active item mid-fade at 4.3:1 (CSS fixed).
- **Known security gap**: outgoing reads do not pin the connection to the checked address, so DNS rebinding is still possible. Node exposes no undici Agent without adding the package.

## What is left

### 2.2 — needs the user
- **Live check** on your own computer: `npm run live-check -- --include-blocked --save-html --alerts` (or `--eml <folder>` instead of `--alerts`). Send back `live-check-YYYY-MM-DD/report.md` and `bundle.json`, after reading both.
- **Real alert samples**: 2-3 saved `.eml` alerts per service (BC Bid, Bonfire, CanadaBuys, bids&tenders, plus any addendum, cancellation or award alert), and the real sender addresses for CanadaBuys, bids&tenders, MERX and Biddingo, to confirm `ALERT_SENDER_DOMAINS` and tune parsing.
- **D4**: the CRD's current bids page URL. CRD stays off until then.
- **CI on GitHub** (OPS-12): see the workflow run on GitHub, including the `docker` and `node-floor` jobs, which cannot run here.
- **Phone checks**: mark a real bid "Pursue" and confirm the 72 h and 24 h reminders arrive; confirm that a moved closing on a pursued bid sends one phone alert and one e-mail.
- **Netlify**: turn on form detection, check that `notice-feedback` shows under Forms, and send one per-bid feedback from the deployed prototype.

### 2.4 — release
- Set the version to `0.2.0-beta` in `package.json` (it still says `0.1.0`) and date the CHANGELOG entry.
- Tag `v0.2.0-beta` and open the PR once the user says OK (D27, D29). If the 2.2 results are not back by then, tag with honest statuses and ship 2.2 as `v0.2.1-beta`.
