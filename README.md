# Lgbids

Finds gardening and landscaping bid opportunities in Greater Victoria, BC, works out which ones suit your company, drafts your submission for each, and tracks them through to the closing date. It runs as one small web app on your own computer or server.

## What it does

1. **Finds** — several times a day it reads the public bid listings below.
2. **Qualifies** — each notice is checked: is it landscaping work, is it in Greater Victoria, is it still open, is it a service you offer, and does it ask for anything you do not have (bonding, a certification, a higher insurance limit, a site meeting that has passed). Every decision comes with its reasons.
3. **Prepares** — for each suitable notice it drafts a submission package (cover letter, company information, references, rates, compliance) from your company profile, and a checklist of what the buyer requires.
4. **Submits** — where the buyer accepts bids by e-mail, it sends the submission from your own mailbox, when you press Send. Where the buyer uses a bidding portal or hard copy, it gives you the finished package to upload and tracks the deadline.

### What it does not do

- **It does not log in to bidding portals.** Bonfire, BC Bid and bids&tenders each need your own account and a different set of uploads per bid. For those, the app prepares the package and you upload it.
- **It does not price lump-sum jobs.** A total price needs the bid documents and usually a site visit. The app holds the submission until you enter the price. Rate-based requests use the rates in your profile.
- **It does not fill in the buyer's own forms.** If a notice requires them, the submission is held until you attach the completed forms.

A bid is a formal offer, so nothing is sent until you review it and press Send. (The server still supports a fully automatic mode with strict rules, but it is hidden in this beta.)

## Sources

Checked against the live sites on 2026-11-17:

| Source | Covers | Status |
| --- | --- | --- |
| **Bid alert e-mails** (BC Bid and Bonfire) | Everything BC Bid and the Bonfire portals e-mail you about | **New, off until set up.** Reads the alert e-mails in your Gmail (read-only) or `.eml` files you import. The reader is tested on invented sample alerts only; send real ones to confirm it (see below). |
| District of Saanich feed | Saanich quotation requests and RFPs | **Works.** Titles, references, closing times and links checked against saanich.ca. |
| Township of Esquimalt page | Esquimalt's own postings | **Works.** Titles, types, closing times, status (open/awarded/cancelled) and documents checked against esquimalt.ca. |
| District of Oak Bay page | Oak Bay's own postings | On, **not yet checked**: the address moved to www.oakbay.ca and could not be reached from the development environment. |
| BC Bid notices (via CanadaBuys) | Most municipalities, school districts and public bodies | **Off.** canadabuys.canada.ca asks automated tools not to read it (robots.txt). Use BC Bid's own e-mail notifications. |
| Government of Canada open data | Federal sites: CFB Esquimalt, Parks Canada | **Off**, same reason. Use a saved CanadaBuys search with e-mail alerts. |
| Bonfire portals | City of Victoria, Saanich, Central Saanich, North Saanich, UVic | **Off.** Bonfire's robots.txt disallows all automated reading. Follow each buyer on Bonfire with a free vendor account. |
| Capital Regional District | CRD | **Off.** The old bid site (bid.crd.ca) no longer answers; its replacement has not been checked yet. |
| CivicInfo BC | Smaller municipalities | **Off.** A Cloudflare browser check blocks automated reading. |

Lgbids does not work around a site's robots.txt or browser checks. Instead, BC Bid and Bonfire bids reach it through **their own alert e-mails**:

1. Turn on the alerts: BC Bid e-mail notifications for your landscaping and grounds-maintenance commodities, and "follow" each buyer on its Bonfire portal (free vendor account).
2. Optional: a Gmail filter that labels mail from `bcbid` or `bonfire`, for example "Bid alerts".
3. Create a Gmail **app password** (Google Account → Security → 2-Step Verification → App passwords).
4. In Lgbids: **Settings → Bid alert inbox** — Gmail address, app password, folder or label → Save → Test connection.

Lgbids opens the folder read-only, fetches only messages from BC Bid and Bonfire, and never marks, moves or deletes mail. It never opens the links in the alerts. Without an inbox, you can drop saved alerts (`.eml`, Gmail ⋮ → "Download message") on the **Sources** page. Outlook.com / Microsoft 365 no longer allow app-password sign-in; forward the alerts to Gmail instead.

**Not yet proven:** the alert reader was written without real BC Bid or Bonfire alert e-mails and is tested on invented ones. Import a few real alerts and check the titles and closing dates it shows; if something is wrong, the alert's layout needs a small fix.

On the Sources page you can turn each source on or off and test it, and each turned-off source says why. Adding your own sources is not offered in this beta.

The app identifies itself, respects each site's robots.txt, and spaces its requests out.

## Run it on your computer

The easiest way: install [Node.js](https://nodejs.org) (the LTS version, 22.13 or newer), download this folder, and double-click the launcher for your system:

| System | Double-click | Notes |
| --- | --- | --- |
| Windows | `Start Lgbids.bat` | |
| macOS | `Start Lgbids.command` | The first time, macOS may say it cannot open it: Control-click it, choose **Open**, then **Open** again. |
| Linux | `start-lgbids.sh` | Or run `./start-lgbids.sh` in a terminal. |

From a terminal, `npm run app` does the same.

**On the first start** the launcher installs what the app needs (this needs the internet and takes a minute or two), builds it, starts it and opens http://127.0.0.1:3000 in your browser. Later starts take a few seconds; after an update it reinstalls and rebuilds only when something changed. Keep the window open while you use the app: closing it, or pressing Ctrl+C in it, stops Lgbids. Starting it while it is already running just opens the browser.

**Your data** (database, uploaded documents, settings including the mail password) lives in the `data` folder inside the Lgbids folder. Back it up and keep it private. To change where it lives, or the port, put `DATA_DIR=...` or `PORT=...` lines in a `.env` file next to the launchers (see the table under *Settings by environment variable*); `LGBIDS_NO_BROWSER=1` stops it opening the browser.

**Keep it running.** Lgbids only checks for bids and sends alerts while it is running and the computer is awake. To start it when you log in (add `--no-browser` where you can, so no browser window pops up each time):

- **Windows**: Task Scheduler → *Create Basic Task* → trigger *When I log on* → action *Start a program*: pick `Start Lgbids.bat`, add the argument `--no-browser`, and set *Start in* to the Lgbids folder.
- **macOS**: System Settings → General → Login Items → **+** → choose `Start Lgbids.command`.
- **Linux**: save this as `~/.config/systemd/user/lgbids.service` (change the folder, and the node path to what `command -v node` prints), then run `systemctl --user enable --now lgbids` (and `loginctl enable-linger` to keep it running after you log out):

```ini
[Service]
WorkingDirectory=%h/Lgbids
ExecStart=/usr/bin/node scripts/launch.mjs --no-browser
KillMode=mixed
Restart=on-failure
[Install]
WantedBy=default.target
```

**What it can and cannot reach.** Saanich and Esquimalt are read directly. BC Bid and Bonfire bids come in only through the alert e-mails those sites send you (turn them on in your BC Bid and Bonfire accounts, then set up **Settings → Bid alert inbox**); the app never logs in to those portals or opens the links in the alerts. See *Sources* above for every source and its status.

### Phone alerts

To hear about new suitable bids and close deadlines on your phone, turn them on under **Settings → Phone alerts**; the page walks you through it. Alerts go out from the app on your computer, so they only arrive while it is running.

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
| `TRUST_PROXY` | (off) | Set to `1` behind an HTTPS reverse proxy so sign-in cookies are marked secure |
| `TZ_LOCAL` | `America/Vancouver` | Time zone for closing dates |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | (none) | Outgoing mail, instead of the Settings page |

### Running on a server

```
docker build -t lgbids .
docker run -d -p 3000:3000 -v lgbids-data:/data -e APP_PASSWORD=choose-a-long-one lgbids
```

If it is reachable from the internet, put it behind HTTPS. With [Caddy](https://caddyserver.com) that is one line in the Caddyfile:

```
bids.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

and run the app with `TRUST_PROXY=1`. `GET /api/health` answers `{"ok":true}` without signing in, for uptime monitors.

### Backups and updates

Everything (database, uploaded documents, settings including the mail password) lives in `DATA_DIR`. Back that folder up, and keep it private. To update: stop the app, `git pull`, `npm install`, `npm run build`, start it again. Keep Node.js on the latest 22.x release: British Columbia has been on UTC−7 all year since 2026, and older releases show closing times an hour off (the app warns at start-up if yours is affected).

## Beta testing

During the beta, keep **Settings → Automation** on "Find, score & draft applications for my approval" so nothing is sent without you pressing Send. Please note:

- any notice you know about that the app missed (title and where it was posted),
- any notice marked suitable that is not (and why),
- anything in a drafted letter or package you had to correct,
- anything on screen that was confusing.

Before the first real run, check the sources: `npm run check-sources`, or **Sources → Test** for each. Saanich and Esquimalt were checked against the live sites; Oak Bay was not (see the Sources table).

### Hosted prototype for testers (Netlify)

`npm run build:prototype` builds the web UI as a static site in `dist/prototype`, running on invented sample data in the browser (`src/web/mock.ts`). There is no server: nothing is read from bid sites and nothing is sent. Testers get a bar at the top with **What to try** (a short task list), **Send feedback** and **Start over**. Their changes are kept in their own browser (localStorage) until they press Start over; files they upload last until the tab is closed. The package PDF and calendar downloads are built in the browser.

Deploy on Netlify, either way:

- **From the repository**: *Add new site → Import an existing project*, pick this repository and the branch to publish. `netlify.toml` already sets the build command (`npm run build:prototype`), the folder (`dist/prototype`) and Node 22.
- **By hand**: run `npm run build:prototype` and drag the `dist/prototype` folder onto *Sites → Deploy manually*.

Feedback arrives under **Forms → beta-feedback** in the Netlify site (Netlify detects the form on the first deploy; turn on form detection under *Forms* if it asks). Each entry carries the kind, the message, the page, the screen size and the browser. Set up a form notification there to get each one by e-mail. The prototype sends `noindex` headers and a `robots.txt` so search engines leave it alone; share the link only with your testers.

## Development

```
npm run dev          # server + web UI with reload
npm test             # unit and integration tests
npm run typecheck
npm run check-sources
```

Every push and pull request runs the type check, the tests and both builds on GitHub Actions (`.github/workflows/ci.yml`).

Code layout: `src/server/sources` (readers), `src/server/matching` (scoring), `src/server/applications` (drafting), `src/server/pipeline` (the scheduled run), `src/server/routes` (API), `src/web` (UI), `src/server/demo` (sample sites).
