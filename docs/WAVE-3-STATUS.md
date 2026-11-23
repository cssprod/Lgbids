# Wave 3 status (handoff, 2026-11-23)

Plan: docs/WAVE-3.md (full six-lane option). Your answers are recorded in its §5.1 and in CLAUDE.md "Wave 3 decisions": every recommended default, FLAG-3, FLAG-4 and FLAG-9 approved (built in the 3.3 fix pass), `wave3/*` lane branches pushed after each green package.

## Branches
- `ccr-707adaf0-joblwh`: the release branch (v0.2.0-beta plus the Wave 3 plan). It stays as it is until 3.3 merges `wave3/integration` back.
- `wave3/base`: cut from the release branch. It holds W3-0A, and the 3.0 foundation merges into it.
- `wave3/probe`: a leftover test branch on GitHub. This session could not delete it; delete it on GitHub.
- Tag `v0.2.0-beta` exists only locally on 644df96, because this session may not push tags (HTTP 403). Create it on GitHub (Releases → Draft a new release → tag `v0.2.0-beta` on commit 644df96), or push it from your computer.

## 3.0 — foundation
- **W3-0A — done** (lead, on `wave3/base`):
  - CI now runs on pushes to `wave3/**`.
  - Playwright reuses a running server only when `E2E_REUSE=1`, and every test runs with reduced motion.
  - One global `prefers-reduced-motion` rule ends animations and transitions; the spinner keeps its slow turn.
  - Coverage thresholds were re-measured (89.43 / 79.47 / 92.32 / 93.05) and set one point lower.
  - `undici` 7.30.2 is a direct dependency (`npm ls undici` shows one copy).
  - The package scripts `check:lane`, `upgrade`, `calendar-check` and `pdf-text` point at placeholders that print "Not built yet." and exit 2.
  - Gates: `npm run verify:full` is green (613 tests, 46 Playwright tests), and `e2e/a11y.spec.ts` passed five runs in a row.
- **Next: 3.0b** (workflow in docs/WAVE-3.md §8.7):
  - F-0s runs W3-0B → W3-0C1 → W3-0C2 → W3-0C3 in the worktree `/home/user/lgbids-wt/F0` on `wave3/F0`.
  - Then F-0w (W3-0D1, W3-0D2) and T-0 (W3-0E, W3-0F, W3-0G) run on `wave3/T0`.
  - Create those two worktrees from `wave3/base` as in §8.4 first, with the node_modules link and `check-ignore`.
- **Then 3.0c** (lead): merge F0 and T0 into `wave3/base` in `/home/user/lgbids-wt/base`, re-measure the bundle budgets (E9), and run W3-1M (`scripts/lanes-v3.json`, the lane worktrees D, P, R, A, C, H and integration).

## After 3.0
- 3.1: six lanes (§8.1) with one contract window.
- 3.2: your checks (Wave 2 "2.2" in docs/WAVE-2-STATUS.md, plus §5.3).
- 3.3: integrate in the order H, A, D, P, R, C; reviews; fix batches, including the approved FLAG-3, FLAG-4 and FLAG-9 batch; docs.
- 3.4: 0.3.0-beta, tagged only with your OK.

## Notes for the next session
- The container is disposable: anything not pushed is lost. `wave3/base` is pushed.
- After a fresh clone, run `npm ci` in the main checkout, then recreate the worktrees and node_modules links (§8.4). The worktree `/home/user/lgbids-wt/base` must be checked out on `wave3/base`.
