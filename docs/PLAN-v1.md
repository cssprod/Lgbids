# Lgbids v1 — a complete bidding system for recurring grounds-maintenance contracts

## Context

**Where it is now (2026-11-18).** Lgbids is a working single-company beta: it finds landscaping notices around Greater Victoria (Saanich RSS, Esquimalt, Oak Bay unverified, plus BC Bid/Bonfire **alert e-mails** read from Gmail over read-only IMAP), scores them by rules (`src/server/matching/analyse.ts`), drafts a submission from the company profile (`applications/draft.ts`, `templates.ts`, `pdf.ts`), e-mails it on approval or packages it for portal upload, and tracks it. 254 tests pass, UI verified (axe 0, Lighthouse 94–100), Docker image and Netlify prototype exist. Still open from `docs/PLAN.md`: real alert samples, CRD/Oak Bay checks, the beta itself.

**What the user asked for.** Turn it into a full, better-than-industry-standard automated bidding system for landscaping, greenskeeping, lawn maintenance and garden care, **mainly recurring contracts**. Clarified answers:
- **For one company only**: the user's friend, in **Greater Victoria**. No SaaS, billing or multi-tenancy now. Later the user will tailor copies per client (100 km around each client's base, possibly an assisted onboarding). This plan keeps that path open but does not build it.
- **Every way of finding work**: public tenders, private RFPs (property managers, stratas, HOAs, commercial sites), and a buyer-facing side. With one contractor, the "marketplace" means a quote-request page and a proposal page for that company. A marketplace shared by many contractors waits for the multi-client stage.
- **No AI** (user decision 2026-11-18): everything stays rule-based, as CLAUDE.md already records.
- **No AWS for now**: it keeps running on the friend's computer or any Docker host (`npm start` / the existing Dockerfile). Cloud hosting is a later decision.

**What the product has to do that it does not do yet:** understand recurring contracts (term, option years, season, visit frequency, site lists, how prices are asked for), **price them** (site takeoff → hours → cost → margin → per-visit, yearly and multi-year price), produce compliant proposals quickly, take private work in, and manage what happens after the bid (outcomes, contracts, renewals, predicting when contracts are re-tendered, learning from wins and losses). It also has to run reliably every day.

## Targets ("better than industry standard", measured)
| Area | Target |
|---|---|
| Coverage | ≥ 95 % of Greater Victoria public grounds/landscape notices reach Lgbids within 24 h. Checked by a monthly hand audit plus the missed-bid report (M5). |
| Qualification | ≥ 80 % of notices marked "Suitable" are ones the friend pursues; < 5 % of pursued ones were scored unsuitable. |
| Speed | A recurring RFQ goes from notice to a priced, compliant package in ≤ 45 min (typically several hours by hand). |
| Estimating | Estimated yearly hours within ±10 % of actual hours after one season (M3.6). |
| Trust | 0 sends without approval (auto stays opt-in with its guardrails); 0 claims in a bid that are not in the profile or the approved content library. |
| Operations | Nightly backups with a monthly restore drill (restore ≤ 1 h); axe 0 violations; Lighthouse ≥ 90. |

## Decisions this plan changes (write into CLAUDE.md "Decisions" at the start of M0)
1. "No AI/LLM dependency" **stays**.
2. "Default host 127.0.0.1; `APP_PASSWORD`" gains **user accounts, roles and TOTP two-step sign-in** (needed once the friend reaches it from his phone or another person uses it); `APP_PASSWORD` stays for single-user local use and the demo.
3. "Does not fill in the buyer's own forms" becomes **fills fillable PDF (AcroForm) and XLSX price forms for review**. Non-fillable forms are still flagged for hand transfer.
4. **Private work added**: an RFP inbox, a public quote-request page, and a proposal page with electronic acceptance. The two public pages need the app reachable from the internet (HTTPS reverse proxy, e.g. Caddy, as in the README); until then they stay off.
5. Beta trims stay. Auto mode stays hidden until at least 20 bids have gone through prepare mode, then decide. "Add a source" stays hidden; the buyer register (M2.1) handles coverage.

**Unchanged:** never work around robots.txt or bot checks; never open alert links; IMAP read-only; no portal logins; all send guardrails (`sending` before SMTP, no auto-resend); time-zone rules; date-only closings; no service worker; Activity not in the menu; keep `src/web/mock.ts` and demo fixtures in step with each feature.

## Working rules (from the `lean-build` skill and CLAUDE.md)
- One item at a time: zod schema in `src/shared/schemas.ts`, then pure logic (`matching/`, `estimating/`, `util/`, no I/O), store and migration, route, web API client and hook, page, tests (`web-feature` skill). `npm test`, `npm run typecheck`, `npm run build` green. Commit and push to `ccr-382195fd-ddn541` after each item; tick it in `docs/PLAN.md`.
- New tables go in as numbered entries in `MIGRATIONS` (`src/server/db/database.ts`, versioned by `user_version`). Each gets a test that upgrades a copy of the current schema.
- Money in integer cents, quantities with explicit units, test dates in June/July, fixture e-mail addresses on `.example` only.
- UI work follows `ui-design-system` and `ux-patterns`, then a `ui-quality-pass`.
- Live sites and Gmail cannot be reached from the cloud sandbox. Build against recorded fixtures; the friend (or the user) runs `npm run check-sources` on his own machine for live checks.

---

## M0 — Ready for daily use by the friend (≈ 1 week)
1. **Accounts and roles.** Add a `users` table (email, name, role `owner|estimator|viewer`, scrypt hash via `node:crypto`, encrypted TOTP secret, last sign-in) and `sessions.user_id`. Extend `src/server/routes/auth.ts`: e-mail + password, then a TOTP step (RFC 6238 on `node:crypto`, no new dependency), password reset by e-mail, invite a user, lockout (already there). `requireRole` in `routes/util.ts`; only an owner sends bids, approves prices or changes settings. `actor_user_id` on `events` for an audit trail. `APP_PASSWORD` mode maps to one owner. Tests: `tests/auth.test.ts`, `tests/api.test.ts`.
2. **Secrets encrypted at rest.** `src/server/util/secrets.ts` (AES-256-GCM, key from `SECRETS_KEY` or a generated key file in the data dir) for the SMTP and IMAP passwords in `src/server/settings.ts`; a migration encrypts stored values. The API still never returns them.
3. **Backups.** Nightly `VACUUM INTO` snapshot plus a copy of `files/` into `<dataDir>/backups` (keep 14), an optional second folder (e.g. a synced cloud-drive folder) set in Settings, and `scripts/restore-drill.sh` that restores into a scratch dir and checks record counts. Documented in the README.
4. **CI** (`.github/workflows/ci.yml`): `npm ci`, typecheck, test, build, Playwright smoke run in demo mode on every push.
5. **Health alerts**: e-mail the owner when a source fails 3 runs in a row, a scheduled run is missed, or a send fails.
6. **Loose ends from `docs/PLAN.md`**: the friend runs `check-sources` for www.crd.ca and www.oakbay.ca; collect 2–3 real BC Bid and Bonfire alerts each, anonymise into `tests/fixtures/`, fix `sources/alerts/parse.ts`; first real Gmail "Test connection".
7. **The friend's setup**: profile, documents, SMTP with a test send, alert inbox, mode **prepare**.

*Exit:* the friend uses it daily in prepare mode; restore drill passes; CI green.

## M1 — Understand recurring contracts (≈ 2 weeks, rules only)
1. **`src/server/matching/contractTerms.ts`** (pure). From the notice and document text (`documentText` already comes through unpdf) extract:
   - term and option/renewal years ("3 years with two 1-year options"), start and end dates, season window ("April 1 to October 31");
   - visit frequency per service ("weekly", "bi-weekly", "26 cuts", "every 10 days in the growing season"), and snow response times;
   - site count and site list (table rows with names and addresses), quantities (m², ha, linear m, number of trees or beds);
   - how the price is asked for (yearly lump sum, per visit, unit-rate schedule, hourly, schedule of prices);
   - evaluation criteria and weights ("Price 40 %"), escalation/CPI clause, holdback, termination for convenience, incumbent hints.
   
   Each extracted value keeps the text snippet it came from. Add a `ContractTerms` zod schema in `schemas.ts`. Store it inside the `analysis` JSON, with new `is_recurring` and `annual_value_cents` columns for filtering and sorting.
2. **Scoring** (`analyse.ts`): new reasons and weights for recurring work (settings in `automationSchema`, under the collapsed "Advanced" section): recurring preferred, minimum term, lifetime value, how much of the evaluation is price. Distance and crew capacity reasons join in M3. Reasons keep the existing tone/text format.
3. **Wider vocabulary** (`relevance.ts`): greenskeeping and golf course maintenance, sports turf, cemetery grounds, boulevards and medians, rights-of-way vegetation, strata/HOA grounds, park maintenance, winter maintenance. No new service keys; these map onto `lawn`, `grounds`, `vegetation` and `snow`.
4. **UI**: a "Recurring" chip, term and yearly value on list rows; a "Recurring only" filter and a sort by yearly value (`routes/opportunities.ts` plus the store query); a "Contract at a glance" card on `OpportunityDetail.tsx` where each value shows its source snippet.
5. **Fixtures**: 8–10 real Greater Victoria recurring maintenance notices and documents, saved as text, contacts anonymised to `.example` (collected by running a check on the friend's machine).

*Exit:* rules reach ≥ 90 % field accuracy on the fixture set (`tests/contractTerms.test.ts`); demo fixtures include recurring notices.

## M2 — Every way of finding work (≈ 2.5 weeks)
1. **Buyer register and coverage.** Move `DEFAULT_ORGANIZATIONS` out of `geo.ts` into `src/server/data/buyers.ts`. Each buyer records where it posts (own page, BC Bid, Bonfire, CivicInfo, bids&tenders, MERX, CanadaBuys) and how Lgbids receives it (reader, alert e-mail, cannot be read).
   - Buyers: the 13 municipalities (Victoria, Saanich, Oak Bay, Esquimalt, View Royal, Colwood, Langford, Metchosin, Highlands, Sooke, Central Saanich, North Saanich, Sidney); CRD and Capital Region Housing; SD61, SD62, SD63; UVic, Camosun, Royal Roads; Island Health; BC Housing; Victoria Airport Authority; Greater Victoria Harbour Authority; BC Transit; provincial ministries (BC Bid); federal sites (CFB Esquimalt, Parks Canada, through CanadaBuys alerts); local First Nations that post their own tenders.
   - Add a reader only where robots.txt allows it, checked with `check-sources` on the friend's machine. A new "Coverage" section on Sources lists every buyer, its route and the last notice seen.
2. **More alert formats** (`sources/alerts/parse.ts`): bids&tenders, MERX, CanadaBuys and CivicInfo alerts, each tested on real anonymised samples. Mail from senders that are not known alert services goes to RFP-inbox triage instead of being skipped.
3. **Private RFP inbox** (new source `rfp-inbox`, reusing the read-only `sources/alerts/mailbox.ts`): a Gmail label such as "RFPs", any sender. One e-mail thread becomes one opportunity; attachments are stored and read (PDF through unpdf; DOCX through `mammoth`; XLSX through `exceljs`). The buyer is the sender's organisation and the submission goes by reply. In `analyse.ts`, private notices skip the public-buyer area rules and, when no closing date is given, get a "reply by" date (a setting).
4. **Quote-request page** (`/q/<slug>`, public, no sign-in, linkable or embeddable on the friend's website): property type, site address, services, frequency, start date, contract length, photos, contact details, consent. Protection: honeypot field, minimum fill time, per-address rate limit, size caps, its own route namespace with no session. Each request becomes an opportunity (source `quote-requests`) and notifies the friend.
5. **Proposal page with acceptance** (`/p/<token>`, 32 random bytes, expires): the proposal as HTML and PDF, questions and answers, and "Accept and sign" (typed name and title, tick box, time, IP address, browser, SHA-256 of the PDF; a signed copy is e-mailed to both sides). The friend's lawyer reviews the terms template; the BC Electronic Transactions Act covers electronic acceptance. Off until the app is reachable over HTTPS. Acceptance creates a contract (M5).
6. **Prospect pipeline (light CRM).** Accounts (strata corporations, property managers, HOAs, commercial landlords, private schools, churches, golf courses, cemeteries), contacts, sites, current contractor, contract end month, next follow-up. CSV import.
   - Outreach: template e-mails sent one at a time from the friend's mailbox after approval, never in bulk or automatically.
   - Canadian anti-spam law (CASL): store the consent basis, date and source for each contact; every message identifies the sender and has an unsubscribe link (`/u/<token>`); unsubscribes are honoured right away. BC privacy law (PIPA): a stated purpose and a delete-contact action.
7. **Re-tender radar (first part).** Award and intent-to-award notices are currently only blocked. Keep them as `awards` records (buyer, title, winner, value, award date, term, estimated end). The friend can also add contracts he knows about. Predicted re-tender date = end − the buyer's usual lead time (default 4 months, learned per buyer). Alerts at 120, 60 and 30 days.

*Exit:* the demo shows a notice from each new route (RFP e-mail, quote request, award record); the coverage view lists every buyer; public routes pass rate-limit and abuse tests.

## M3 — Estimating and pricing engine (≈ 3 weeks; the core addition)
1. **Pure module `src/server/estimating/`**, fully unit-tested, money in cents:
   - `catalogue.ts`: default maintenance tasks — mowing (rotary, reel, flail), trimming, edging, blowing, litter, bed weeding, mulching, shrub pruning, hedges, leaf clean-up, aeration, overseeding, top-dressing, fertilising, sports-field lining, irrigation start-up / monthly check / winterising, snow plowing, salting and shovelling, invasive plant removal. Each has a unit and a default production rate labelled "starting point — set your own", and these rates never appear in a bid.
   - `season.ts`: a Victoria growing-season calendar (mowing weeks per month, editable); frequency → visits per year.
   - `labour.ts`: loaded hourly cost = wage + vacation pay + CPP/EI + WorkSafeBC premium (the rate the friend enters for his classification) + benefits; equipment hourly rates; overhead recovery.
   - `travel.ts`: drive time from the yard × visits × crew, mobilisation, minimum charge per visit.
   - `price.ts`: cost → price at a target margin, rounding, per visit / monthly / yearly, multi-year with escalation, option years, taxes as configurable lines (GST by default; the friend confirms what applies).
   - `schedule.ts`: maps estimate lines onto the buyer's schedule-of-prices items.
2. **Site takeoff**, four ways:
   - a table entered by hand;
   - site lists and quantities taken from the notice (M1);
   - a **map measuring tool**: Leaflet + Geoman, drawing turf, beds, hedges and hard surfaces, with geodesic area and length (`@turf/area`, `@turf/length`). Addresses through the free BC Address Geocoder; imagery from a provider whose terms allow measuring (chosen at build time, CSP widened for its host). Drive time from the yard is entered per site, with a distance-based estimate as the default;
   - **open GIS park polygons** (City of Victoria, Saanich, CRD open data), each dataset licence-checked, with extracts recorded as fixtures.
   
   New tables: `sites`, `takeoff_items`.
3. **Estimate UI** (an "Estimate" tab on the opportunity): Sites → Takeoff → Tasks and frequencies (filled in from contract terms) → Crew and rates → Summary (hours per year, crew-days, cost, margin; price per visit, per year and for the term) → Sensitivity (margin slider, production ±10 %). Estimates are versioned, and an owner must approve one before its price can go into a submission. The approved price fills `applications.price_total` and adds a price-schedule attachment in `pdf.ts`. New tables: `estimates`, `estimate_lines`.
4. **Crew capacity**: crews (count, size, season availability) and weekly hours already committed to won contracts (M5). Scoring gains a reason such as "Adds 14 h/week from April to October; you have 9 h spare."
5. **Buyer price forms**: fill fillable PDF forms with `pdf-lib` and XLSX price forms with `exceljs`; always shown for review before sending. Non-fillable forms get a matching price page and a "copy onto the buyer's form by hand" checklist item. Update the README's limits section.
6. **Actual hours** (optional): import crew hours per site from CSV, then an "estimated vs actual" report and suggested production-rate changes.

*Exit:* hand-checked examples pass (for instance, weekly mowing of a 2.5 ha park over a season, plus a strata site list with beds and hedges); the golden path estimate → approval → price → package works in the demo with Playwright.

## M4 — Proposals that win (≈ 2 weeks)
1. **Compliance matrix**: each requirement → where the proposal answers it → supporting document. Missing items hold the submission, extending `assessReadiness` in `draft.ts`. Page limits, mandatory forms, and one acknowledgement item per addendum.
2. **Content library**: reusable blocks approved by the owner (approach, quality control, safety plan, environment, equipment, communication, snow response plan, staffing, transition plan for a new contract, project sheets with photos, references with their consent). Blocks are tagged by service and evaluation criterion; drafts pick blocks by the buyer's criteria. New table: `library_blocks`.
3. **Branded package** (`pdf.ts`): logo, colours, table of contents, page numbers, buyer reference on every page.
4. **Addenda and questions**: a changed page hash on readable sources, or "addendum" in an alert e-mail, raises a notice and adds an acknowledgement item. Track the question deadline and keep a list of questions to ask.
5. **Compliance vault**: reminders 30 and 7 days before a document in `documents` expires; a fresh WorkSafeBC clearance letter is prompted before each submission when the stored one is older than N days (a setting); add the Inter-Municipal Business Licence, COR and pesticide licence kinds. An expired attachment holds the submission.
*Exit:* compliance-matrix and readiness tests; a library-based draft states nothing outside the profile and approved blocks (test).

## M5 — After the bid: outcomes, contracts, renewals, learning (≈ 2.5 weeks)
1. **Outcomes**: won, lost, not awarded or cancelled, with winner, price and rank (from published bid results or the buyer's debrief), plus a debrief-request template.
2. **Contracts** (`contracts` table): created from a won application or an accepted proposal. Holds buyer, sites, scope, schedule, term, option years and their decision dates, price per year with escalation dates, insurance and WorkSafeBC obligations, and performance notes. Reminders 90/60/30 days before each option, renewal or escalation date. The contract end feeds the radar.
3. **Re-tender radar (complete)**: the friend's own contracts, award records and buyer history give a predicted date, an early preparation checklist (site visits, references, updated rates) and a watch list on Today.
4. **Capacity calendar**: committed hours per week from the contracts' estimates against crew capacity.
5. **Analytics page** (SVG charts in the design tokens; use the `dataviz` skill when building it):
   - win rate by buyer, service, notice type and size; price difference against the winner;
   - weighted open pipeline; yearly recurring revenue from contracts; time to bid;
   - **missed-bid report**: suitable notices that closed without action, and notices first seen well after they were published, which show where coverage is short;
   - source coverage report.
6. **Learning loop**: a smoothed per-buyer and per-service win rate becomes a scoring reason ("You have won 3 of 4 Saanich mowing bids"). Unit-price benchmarks from published bid results become a reason on the estimate ("12 % above the median recent winning price for similar work").
7. **Exports**: ICS for contract schedules (extending `routes/calendar.ts`); CSV of contracts and customers for QuickBooks Online or other tools.

*Exit:* analytics totals checked by hand against demo data; reminder and radar tests run on a fixed clock.

## M6 — Daily use (≈ 2 weeks)
1. **Bid board** (kanban): Found → Qualifying → Estimating → Writing → Ready → Submitted → Won/Lost, with an owner and due date per bid. Moving a card also works from the keyboard and from a menu.
2. **Today, redesigned**: closings, site meetings, addenda, question deadlines, renewals, radar dates, expiring documents, tasks, all in one dated list.
3. **Notifications**: settings per user; the existing e-mail digest; urgent items (closing within 24 h and unsent, new addendum, accepted proposal, quote request) as separate immediate e-mails, which phones show as alerts; quiet hours. SMS is left for later.
4. **Site-visit mode** on the phone: site checklist, photos uploaded to the server, notes, GPS stamp, quick map measurements linked to the estimate. Online only (no service worker); uploads retry from the page.
5. **Search everywhere** (opportunities, contracts, accounts, documents) with SQLite FTS5.
6. Help, glossary and first-run steps updated for the new features; `src/web/mock.ts` and the prototype kept in step.

## M7 — v1.0 hardening and release (≈ 1 week)
- `/security-review` and an OWASP ASVS level 2 checklist, with a threat model for the public routes (`/q`, `/p`, `/u`). Rate limits, CSP review (map tiles), `npm audit` and Dependabot, a key-rotation runbook.
- Performance on a synthetic database of 10,000 opportunities: list APIs under 200 ms at the 95th percentile.
- Reliability: restore drill; the crash-during-send test (never re-sent).
- Docs: README (honest limits), runbook (install, update, restore, rotate keys), user guide in Help.
- Full `ui-quality-pass` (every route × 1280/390 × light/dark, axe, Lighthouse); then tag `v1.0.0`. A PR goes to the default branch only when the user asks.

## Later — tailored copies for other clients (outline only, not built in v1)
- Area defined as a home base plus a radius (default 100 km) with geocoded notices; an onboarding that builds the area, buyer register, sources and services from the client's address.
- Hosting (cloud provider to be chosen then), one shared notice catalogue matched per company, tenant isolation, billing, a buyer marketplace shared across contractors.
- **Seams to keep in v1 (cheap):** no Greater Victoria names outside the default data (`geo.ts` defaults, `data/buyers.ts`, fixtures); all data access through the `Store`, `FileStore` and `SettingsService` interfaces (`src/server/contracts.ts`); notice data and company data in separate modules; money in cents.

## New dependencies (each added only in the item that needs it)
`pdf-lib`, `exceljs`, `mammoth`, `leaflet` + `@geoman-io/leaflet-geoman-free`, `@turf/area` + `@turf/length`.

## Needed from the user / the friend
- **M0:** the friend's SMTP details and Gmail app password; 2–3 real alert e-mails per alert service; running `check-sources` once on his machine.
- **M3:** yard address, crew count and size, wages and WorkSafeBC rate, equipment rates, target margin, plus his own production rates or agreement to start from the defaults.
- **M2/M5:** a lawyer-reviewed terms template for private proposals; an initial prospect list; known current contracts and their end dates; a decision on making the app reachable over HTTPS (needed only for the quote and proposal pages).

## Verification
- Every commit: `npm test`, `npm run typecheck`, `npm run build`. CI also runs a Playwright smoke test in demo mode.
- Per milestone: the exit checks above, with focused test files (`tests/auth`, `contractTerms`, `estimating`, `rfpInbox`, `quoteRequest`, `proposalPortal`, `contracts`, `radar`, plus migration tests). Public routes get abuse tests through `fastify.inject`.
- End-to-end golden path in demo mode (Playwright, 1280 and 390): recurring notice → contract card → estimate → owner approval → filled price form → compliance matrix → send (demo SMTP sink) or proposal page → accept → contract → renewal reminder → radar entry. Plus the private path: quote request → estimate → proposal → accept.
- On the friend's install: after each update, `/api/health`, sign-in, "Run now", and `check-sources`. Monthly restore drill. A monthly coverage audit against the BC Bid listings by hand feeds the missed-bid report.

## Order and size
M0 (1 wk) → M1 (2) → M2 (2.5) → M3 (3) → M4 (2) → M5 (2.5) → M6 (2) → M7 (1) ≈ **16 weeks** of focused work. M3 can start in parallel with M2 after M1. The first execution step is to copy this plan into `docs/PLAN.md` as "v1 plan (2026-11-18)" and record the changed decisions in CLAUDE.md.
