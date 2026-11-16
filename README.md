# Lgbids

Finds gardening and landscaping bid opportunities in Greater Victoria, BC, works out which ones suit your company, drafts your submission for each, and tracks them through to the closing date. It runs as one small web app on your own computer or server.

## What it does

1. **Finds** — several times a day it reads the public bid listings below.
2. **Qualifies** — each notice is checked: is it landscaping work, is it in Greater Victoria, is it still open, is it a service you offer, and does it ask for anything you do not have (bonding, a certification, a higher insurance limit, a site meeting that has passed). Every decision comes with its reasons.
3. **Prepares** — for each suitable notice it drafts a submission package (cover letter, company information, references, rates, compliance) from your company profile, and a checklist of what the buyer requires.
4. **Submits** — where the buyer accepts bids by e-mail, it sends the submission from your own mailbox, either when you press Send or automatically if you switch that on. Where the buyer uses a bidding portal or hard copy, it gives you the finished package to upload and tracks the deadline.

### What it does not do

- **It does not log in to bidding portals.** Bonfire, BC Bid and bids&tenders each need your own account and a different set of uploads per bid. For those, the app prepares the package and you upload it.
- **It does not price lump-sum jobs.** A total price needs the bid documents and usually a site visit. The app holds the submission until you enter the price. Rate-based requests use the rates in your profile.
- **It does not fill in the buyer's own forms.** If a notice requires them, the submission is held until you attach the completed forms.

A bid is a formal offer. Fully automatic sending is off by default and, when on, only sends submissions that are complete, addressed to the e-mail given in the notice, above your score threshold, of the notice types you allow, and within a daily cap.

## Sources

| Source | Covers |
| --- | --- |
| BC Bid notices, read from the CanadaBuys site | Most municipalities, school districts and public bodies in the region |
| Government of Canada open data (daily CSV) | Federal sites: CFB Esquimalt, Parks Canada, federal buildings |
| Bonfire portals | City of Victoria, Saanich, Central Saanich, North Saanich, University of Victoria |
| District of Saanich feed | Smaller Saanich quotation requests |
| Capital Regional District bid site | CRD (Gulf Islands and Port Renfrew work is filtered out) |
| Township of Esquimalt, District of Oak Bay pages | Their own postings |
| CivicInfo BC | Smaller municipalities province-wide (non-local filtered out) |

You can add any other listing page, RSS feed or Bonfire portal on the Sources page and test it before saving.

**Important — not yet proven against the live sites.** The readers were written from each site's published format and tested on sample pages; they could not be run against the real sites during development. Treat the first run as the test: the Sources page shows, for each source, whether it answered and how many notices were read, and `npm run check-sources` prints the same from the command line. Expect to adjust one or two.

The app identifies itself, respects each site's robots.txt, and spaces its requests out.

## Getting started

Requires [Node.js](https://nodejs.org) 22.13 or newer (use the latest 22.x: closing times depend on up-to-date time zone data).

```
npm install
npm run build
npm start
```

Open http://localhost:3000, then:

1. **Company profile** — submissions only state what you enter here.
2. **Documents** — upload your insurance certificate, WorkSafeBC clearance letter and business licence.
3. **Settings → Outgoing e-mail** — your mailbox's SMTP details, then "Send test e-mail".
4. **Run now** on the dashboard.

To look around first with invented sample notices (nothing real is read or sent): `npm run demo`.

### Settings by environment variable

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Where the app listens |
| `DATA_DIR` | `./data` | Database and uploaded files — back this folder up |
| `APP_PASSWORD` | (none) | Required before the app will listen beyond localhost |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | (none) | Outgoing mail, instead of the Settings page |

### Running on a server

```
docker build -t lgbids .
docker run -d -p 3000:3000 -v lgbids-data:/data -e APP_PASSWORD=choose-a-long-one lgbids
```

Put it behind HTTPS (a reverse proxy such as Caddy) if it is reachable from the internet. The mail password is stored in the data folder; keep that folder private.

## Development

```
npm run dev          # server + web UI with reload
npm test             # unit and integration tests
npm run typecheck
npm run check-sources
```

Code layout: `src/server/sources` (readers), `src/server/matching` (scoring), `src/server/applications` (drafting), `src/server/pipeline` (the scheduled run), `src/server/routes` (API), `src/web` (UI), `src/server/demo` (sample sites).
