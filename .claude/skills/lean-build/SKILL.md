---
name: lean-build
description: Continue building Lgbids cheaply. Use at the start of any session on this repo, or when asked to continue, to work from CLAUDE.md instead of re-deriving context, and to keep token use low.
---

# Lean build

Goal: finish the work listed in CLAUDE.md with the fewest tokens, at the same quality bar.

## Start
1. Read `CLAUDE.md` (state, decisions, remaining work). Do not re-research or re-decide anything recorded there.
2. Run `npm test` and `npm run typecheck` once to confirm the baseline.
3. Pick the next unchecked item under "Remaining work", top to bottom.

## Working rules
- One module at a time: write it, typecheck, add a focused test, run only that test file, then move on.
- Read only the files you are about to import from; use Grep for a symbol instead of reading whole files.
- Match existing patterns (see "Conventions" in CLAUDE.md). Reuse helpers in `src/server/util` and `src/server/matching` rather than writing new ones.
- No subagents, no web research, no planning documents. The live bid sites are unreachable from the cloud sandbox; test against `src/server/demo` fixtures only.
- Keep replies to a few lines. Do not paste code back into chat.
- Use dates in summer (June/July) in tests so results do not depend on the time zone data version.
- Never invent company facts in generated bids; never put real e-mail addresses in fixtures (use `.example`).
- Sending a bid is outward-facing: the default mode must stay "prepare for approval"; auto-send stays opt-in with its guardrails.

## Checkpoints
After each finished item: tick it in CLAUDE.md, `git add -A && git commit` with a short message, `git push -u origin <current branch>`. The container is disposable; unpushed work is lost.

## When stuck
Two failed attempts at the same fix: stop, write the exact error and what was tried in CLAUDE.md under "Open problems", and move to the next item.
