# Lgbids roadmap — versions 2, 3 and 4

Version 1 (this release): finds Greater Victoria landscaping and grounds bids from
the sources that allow automated reading, plus BC Bid and Bonfire alert e-mails.
It scores each bid, prepares the submission, sends e-mail bids after approval,
alerts by e-mail digest and phone push (Telegram or ntfy), exports to CSV, starts
with a double-click and runs CI on every push.

## Version 2 — more bids, fewer misses (beta feedback)
- **Live-check the new sources** (Sooke, Langford, Colwood, View Royal, Sidney, CRD, Oak Bay)
  from a machine that can reach them, fix their readers and turn them on.
- **Real alert e-mail samples**: tune the BC Bid, Bonfire and CanadaBuys alert parsers on 2–3
  real `.eml` files each, and add bids&tenders (Sidney) and MERX alert parsers.
- **Score tuning from beta data**: a "Not relevant / Missed this one" button on every notice
  that records the reason; a small weekly report showing which keywords and areas caused
  false positives, so the relevance rules can be adjusted with evidence.
- **Saved searches and per-person alerts**: several users (owner, estimator), each with their
  own phone-alert filter (for example only bids over a value, or only Saanich peninsula).
- **Closing-date watch**: push a reminder 72 h and 24 h before closing for bids marked "Pursue",
  plus a push when a notice changes (addendum, new closing date).
- **Award tracking**: record who won each bid and at what price (from award notices), as the
  base for price benchmarking in v3.

## Version 3 — win more of the bids you find
- **Pricing helper**: a rates sheet in the profile (crew hour, mowing per acre, mulch per yard)
  turns measured quantities from the bid documents into a price estimate with a breakdown the
  user edits; never auto-filled into a bid without review.
- **Document reading upgrade**: extract site lists, frequencies, areas and mandatory site-meeting
  dates from PDF tables into a structured scope; flag insurance, WorkSafeBC and bond amounts
  against the profile.
- **Bid/no-bid scorecard**: distance from the yard, crew capacity in the contract months,
  past win rate with that buyer, margin estimate.
- **Calendar sync**: two-way CalDAV or Google Calendar for site meetings and closings
  (today it is one-way .ics).
- **Hosted option**: a managed deployment (Docker on a small VPS or Fly.io) with HTTPS,
  backups of the SQLite file and an upgrade command.

## Version 4 — a product for other contractors and regions
- **Multi-tenant**: separate companies with their own profile, sources and users; Postgres
  instead of SQLite; role-based access (owner, estimator, viewer).
- **Region packs**: source sets for other BC regions (Nanaimo, Cowichan, Lower Mainland, Okanagan)
  and other trades (snow clearing, tree care, irrigation, janitorial) using the same lexicon
  and area model.
- **Native phone app** (wrapping the PWA) with real push notifications, offline bid reading and
  photo upload from site meetings.
- **Optional AI assistant**, off by default and behind a clear setting: summarise long bid
  documents and draft scope answers, always as suggestions the user approves, never stating
  facts that are not in the profile.
- **Marketplace for subcontracting**: share a pursued bid with trusted partners for parts of the
  scope (for example irrigation) and collect their quotes in one place.
