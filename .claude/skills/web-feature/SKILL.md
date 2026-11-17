---
name: web-feature
description: How to add or change a full-stack feature in Lgbids end to end — shared zod schema/DTO, API route, server logic, web API client, hook, page/component, tests. Use when implementing any new user-facing feature or API endpoint.
---

# Adding a feature end to end

Work in this order; typecheck after each step.

1. **Contract** — add/extend zod schemas and DTO types in `src/shared/schemas.ts`; add the route to `src/shared/api.ts` (method, path, request, response). camelCase in DTOs; snake_case only in DB columns.
2. **Data** — if storage changes, add a migration step in `src/server/db/database.ts` (never edit old steps; JSON columns as text) and mappers/repository functions in `db/store.ts`.
3. **Logic** — pure logic in `src/server/matching/` or `util/` (no I/O, unit-tested). Side effects (HTTP, SMTP, files) stay in their modules and never throw out of connectors.
4. **Route** — `src/server/routes/*`: validate input with the zod schema, return `{ error: "Full sentence." }` with the right status on failure, never return the SMTP password or secrets. Respect auth/origin checks in `app.ts`.
5. **Tests** — `tests/api.test.ts` style with `fastify.inject`; one happy path, one validation failure, one permission/guardrail case if relevant. Dates in June/July.
6. **Web client** — call through `src/web/api.ts` (`ApiError` carries the server sentence). Add the mock response in `src/web/mock.ts` so `VITE_MOCK=1` keeps working.
7. **UI** — follow `ui-design-system` and `ux-patterns`: four states (loading/empty/error/data), labelled form fields, confirmation for outward-facing actions, `Live` feedback. Dates via `useFormat()`.
8. **Verify** — `npm test`, `npm run typecheck`, `npm run build`, then `ui-quality-pass` on the touched screens.
9. **Docs** — README section if the user would need to know; tick PLAN.md/CLAUDE.md; commit with a short message and push to the session branch.

## Guardrails that must not regress
- Default automation mode `prepare`; auto-send only under every condition listed in CLAUDE.md "Decisions".
- Mark `sending` before SMTP; never auto-resend a `sending` row.
- No portal logins, no AI/LLM dependency, no invented company facts in bids, fixtures use `.example` e-mails.
