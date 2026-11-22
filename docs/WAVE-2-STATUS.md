# Wave 2 status (handoff, 2026-11-22)

Branch `ccr-707adaf0-joblwh` holds 2.0 plus the finished 2.1 packages, merged and green
(`npm run verify` passes, 488 tests; `npm run eval -- --check` passes). Plan: docs/WAVE-2.md, lean mode (section 8.9).

## Done in 2.1
- Lane C: C-1 (COV-3, COV-4, COV-7), C-2 (COV-6, COV-12, COV-8, COV-9)
- Lane M: M-1 (MAT-2, MAT-3, MAT-11, COV-17, MAT-6), M-2 (MAT-4, MAT-5)
- Lane P: P-1 (UX-1, UX-2, UX-3, UX-4, UX-5, COV-16)
- Lane O: O-1 (COV-2, OPS-2, OPS-3, OPS-4), O-2 (OPS-5, OPS-7, OPS-8, OPS-9, OPS-11, TST-13)
- Lane V: TST-2, TST-3, TST-4 (TST-5 not done)

## Remaining 2.1 packages (lean mode; run in this order inside each lane)
- C-3 (COV-10, COV-15) -> C-4 (COV-5)
- M-3 (MAT-8, MAT-7) -> M-4 (MAT-9, MAT-16)
- P-2 (UX-7, MAT-10, MAT-15) -> P-3 (MAT-12, UX-9, UX-10; MAT-13 CLI cut) -> P-4 (UX-11, UX-13)
- V-1b (TST-5) -> V-2 (OPS-12, TST-10)
Then 2.3 (integrate, one combined review, fix pass, docs) and 2.4 (CHANGELOG, v0.2.0-beta), per section 8.9.

## Integration notes
- The merge broke node_modules: lane O committed its node_modules symlink. Fixed (untracked; .gitignore now matches links). Worktrees must never commit node_modules.
- Lane P's two frozen assertions in tests/api.test.ts were updated by the integrator (won/lost correction, the 'push' setup step).
- The prototype's sample "layout may have changed" warning moved from Oak Bay (now ships off) to Esquimalt.

## Contract requests still to apply (integrator, 2.3)
- [M-1] src/server/bootstrap.ts: call recomputeKeys(db) (exported from src/server/db/store.ts) once right after openDatabase and before createStore, so stored ref_key/title_key are rewritten when keys_version != KEYS_VERSION ('2'). It was kept out of createStore because tests/migration.test.ts expects createStore to leave keys_version at '1'.
- [M-1] Optional: AreaResult.rule in geo.ts is optional only because tests/eval.test.ts (outside lane M) builds an AreaResult literal without it; make it required once that test adds rule.
- [C1-a] schemas.ts: consider exporting an AlertKind type ('new'|'addendum'|'closing_change'|'award'|'cancelled'|'other'); parse.ts defines it locally and maps to NoticeEvent (cancelled -> 'cancellation').
- [P-1] src/server/sources/health.ts layoutWarningText: the stored text keeps its v1 wording because tests/pipeline.test.ts:341 (frozen) and tests/connectors.test.ts:497 (C1) assert it. The UI rebuilds the v2 wording from the stored count (status.tsx layoutWarningBody), and health.ts exports layoutWarningTitle, layoutWarningBody and LAYOUT_WARNING_FOOTNOTE. The fix pass can switch the stored text to layoutWarningBody and update those two tests (risk R25).
- [P-1] AutomationSettings respectRobots/userAgent: the UI no longer edits them (D2). Removing them from the schema and the client is COV-2 (O lane) plus schemas.ts (frozen).
- [O-1] tests/helpers/pipelineEnv.ts (frozen): the httpFactory HttpClient should pass allowPrivate: true (it reads local fixture servers on 127.0.0.1); drop respectRobots/userAgent from that call.
- [O-1] tests/connectors.test.ts (lane C): pass allowPrivate: true to the three HttpClient constructors, and replace 'can be told to ignore robots.txt' with a test that respectRobots:false still refuses (D2). Once this and the pipelineEnv request land, delete legacyTestDefaults() in src/server/http/client.ts. It only runs under vitest and only for callers that leave allowPrivate unset, and keeps the old defaults (private addresses allowed, respectRobots:false honoured).
- [O-1] src/shared/schemas.ts automationSchema: respectRobots and userAgent are now ignored by the server (bootstrap httpOptionsFor uses the fixed USER_AGENT = Lgbids/<package version> and always respects robots). Remove both fields, or mark them deprecated, together with the Settings.tsx switch and field (UX-3). The schema default 'Lgbids/0.1 (bid opportunity monitor)' is no longer used.
- [O-1] Integrator: AppConfig.trustProxy may hold a hop count (number). app.ts turns a hop count into a function, because Fastify 5's types reject a plain number. No contracts.ts change is needed.
- [O-1] Not done (other lanes' files): runs.ts (inline ICS) and opportunities.ts (CSV) set their own content-disposition. The CSV attachment gets the sandbox CSP through the app.ts onSend hook; the inline ICS keeps the global CSP.
- [C] src/server/routes/settings.ts (owned by another lane, not edited): the inbox 'Test connection' route reads only `count` from AlertMailbox.test(). It should also return the new optional `bySender` (Partial<Record<AlertSender, number>>) so the UI can show counts per sender (COV-9, user check in section 5.3). The API DTO in src/shared/api.ts needs the matching optional field.

## Needs from the user
- D4: the CRD's current bids page URL (CRD stays off until then).
- Press Test connection on the real Gmail and send the per-sender counts. They only reach the UI once the routes/settings.ts contract request is applied.
- Real From addresses for CanadaBuys, bids&tenders, MERX and Biddingo, plus 2-3 real alert samples, to tune parsing and confirm ALERT_SENDER_DOMAINS.

## Proposed corpus rows (lane M appends them)
- none
