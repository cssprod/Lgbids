---
name: live-sources
description: Phase 4 of docs/PLAN.md — check and fix the built-in bid-site readers against the real sites (CanadaBuys/BC Bid, Bonfire portals, Saanich RSS, CRD, Esquimalt, Oak Bay, CivicInfo). Use when network access to the bid sites is available and the user has asked to verify or fix sources.
---

# Live-source verification

Only when the user has explicitly asked for it in this session and the environment allows the hosts. If a fetch is refused by a permission check, stop and ask the user — do not retry another way.

## Rules
- Read-only. Never submit anything, never create portal accounts, never log in.
- Respect robots.txt, 403s and bot checks: do **not** work around them. Disable that built-in source in `src/server/sources/registry.ts` (enabled: false) with a `notes` sentence explaining why, and how the user can still watch it manually (e.g. e-mail alerts from the portal).
- Before disabling for robots.txt, read the actual robots.txt and confirm our parser (`src/server/http/robots.ts`) reads it correctly for the exact path+query we request; add a test with the trimmed real file if the parser was wrong.
- Save live samples under the scratchpad, never in the repo. Regression fixtures go to `tests/fixtures/` trimmed to a few notices, with personal names/e-mails replaced by `.example`.

## Steps
1. `npm run build && npm run check-sources`; save output to the scratchpad.
2. Per failing source: fetch the page/feed/JSON (curl via the proxy), compare with what the connector expects (`src/server/sources/connectors/*`, `extract.ts`), fix the URL, `linkPattern`, or parser. Wrong URL (404/DNS) → find the current official page from the municipality's site.
3. Per working source: check 3 notices by hand — title, reference, closing date **and time zone** (CanadaBuys zone-less = Eastern, Bonfire `DateClose` = UTC, local sites = America/Vancouver), and link target.
4. Add one regression test per fixed reader in `tests/connectors.test.ts` using the fixture.
5. Fresh `DATA_DIR` in the scratchpad → `npm run run-once`. Report notices per source, number suitable, top 10 titles; check by eye they are Greater Victoria landscaping/grounds work; tune `matching/relevance.ts` / `geo.ts` with tests if clearly wrong.
6. Keep `npm test` + `npm run typecheck` green. Update PLAN.md Phase 4 and README "not yet proven" wording. Commit + push after each fixed source.

## Final report
Table: source | before | after | change made. Then what still does not work.
