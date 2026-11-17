---
name: ux-patterns
description: User-experience rules for Lgbids — onboarding, empty/loading/error states, forms, confirmations, notifications, copy, accessibility and the bid-specific flows (find → qualify → prepare → send/upload → track). Use when designing or changing any screen or flow, adding a feature users touch, or when asked to make the app more user-friendly.
---

# Lgbids UX patterns

The user is a busy owner/office manager of a landscaping company, often on a phone between jobs, not a procurement expert. Every screen answers: *What needs my attention? Why? What do I do next?*

## Core flow (keep it obvious)
1. **Find** — Dashboard leads with "Needs you" (needs-input applications, ready-to-send, closing within 72 h), then new suitable opportunities.
2. **Qualify** — Opportunity detail shows the score, the decision word, and the plain-language reasons (relevance, area, type, deadline) first; raw notice text below. Actions: Pursue / Not for us (with optional reason) / Open original notice.
3. **Prepare** — Application detail is a checklist: each missing item says what is missing and links to the place to fix it (profile field, document upload, price input).
4. **Submit** — E-mail channel: Review → Send (confirm dialog shows recipient, subject, attachments, price). Portal/hard copy: Download package → step list for the portal → Mark as submitted.
5. **Track** — Submitted → Won/Lost, with dates; calendar export of deadlines.

## Every view has four states
- **Loading**: `Loading` skeleton/placeholder with stable layout (no jump when data arrives).
- **Empty**: `Empty` with a title, one sentence of why it is empty, and the next action button ("Run a check now", "Complete your profile"). Never a blank table.
- **Error**: `ErrorBox` with the server's sentence and Retry. Never a raw stack or status code alone.
- **Partial/stale**: show last-updated time ("Checked 12 min ago") and source health problems as a `Callout`, not hidden.

## First-run onboarding
- If profile or e-mail settings are incomplete, the Dashboard shows a setup checklist card (Company profile → Services & area → Documents → E-mail (optional) → First check) with progress, each step linking to its page. Dismissible once complete.
- Defaults are safe: automation mode `prepare`; auto-send needs an explicit acknowledgement. Explain modes in one sentence each beside the control.

## Forms
- Label every field; mark optional ones "(optional)" rather than starring required ones.
- Validate on blur and on submit; error text says how to fix it ("Enter a price in dollars, e.g. 4500"). Focus the first invalid field on submit.
- Save state is explicit: "Saved" confirmation via `Live` (aria-live polite), unsaved-changes warning on navigation for long forms (Profile, Settings).
- Use the right input: `type=email`, `inputmode=decimal` for money, tag editor for lists, toggles for on/off, selects only for ≥ 5 options else radio/segmented.
- Prefill from what is known (profile into applications); never ask twice.

## Actions & safety
- Outward-facing actions (Send, auto mode on) always confirm in a dialog that states exactly what will happen and to whom. Destructive actions (delete source/document) confirm with the item name. Reversible actions (status changes, dismiss) do it immediately and offer Undo in a toast.
- Disabled buttons always explain why (adjacent text: "Add a price to send").
- Prevent double submission: button goes busy, server idempotency already exists — reflect `sending` state in the UI.

## Feedback & notifications
- Toast/`Live` region for results of actions (success 4 s, errors stay until dismissed).
- Badges in the nav for counts that need action (Applications needing input / ready).
- Deadlines shown relative and absolute: "Closes in 2 days — Thu 19 Nov, 2:00 pm" (business time zone). Closing < 72 h = warn tone; past = muted with "Closed".

## Lists that scale
- Search box + filters (status, decision, source, closing window) persisted in the URL query string so links and Back work.
- Sensible default sort (Opportunities: soonest closing among suitable; Applications: needs-action first).
- Bulk actions only where real (mark several "Not for us").
- Pagination or "Show more" past ~50 rows.

## Copy
- Full sentences, plain words, no jargon without explanation ("RFQ — request for quotation"). Tell the user what happened and what to do next.
- Never claim things the app did not verify; generated bids contain only profile facts (CLAUDE.md decision).
- Same words everywhere for the same thing (e.g. "Suitable", "Needs input", "Ready to send", "Submitted").

## Accessibility (non-negotiable)
- Semantic HTML: one `h1` per page, ordered headings, `<button>` for actions, `<a>` for navigation, `<table>` with `<th scope>` for tabular data.
- Keyboard: everything reachable and operable, visible focus, logical order, skip-to-content link, dialogs trap focus and restore it.
- Screen readers: `aria-live` for async results, `aria-describedby` for hints/errors, accessible names for icon buttons, status not by colour alone.
- Touch targets ≥ 40×40 px on phones; text zoom to 200% without loss.

## Performance feel
- Instant navigation (client routing), optimistic updates for small toggles, keep previous data while refetching. Initial JS ≤ ~150 KB gzip; lazy-load heavy pages if it grows.

## PWA
- Manifest with `display: standalone` and icons exists; no service worker (CLAUDE.md decision). Make sure `theme-color` meta matches the brand in both themes.
