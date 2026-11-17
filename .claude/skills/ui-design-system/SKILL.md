---
name: ui-design-system
description: Visual design rules for the Lgbids web UI (src/web) — tokens, type scale, spacing, colour, components, layout, dark mode, motion. Use before changing any styling, adding a component or page, or when asked to make the app look more polished/professional.
---

# Lgbids design system

Target look: a calm, confident, professional SaaS tool for a small landscaping business — think Linear / Stripe dashboard clarity with a natural green brand. Dense enough for daily work, never cramped. Every screen should look intentional at 390 px and 1440 px, light and dark.

## Ground rules
- One stylesheet: `src/web/styles.css`. No CSS framework, no CSS-in-JS, no new UI library. Plain React components in `src/web/components/`.
- Never hard-code colours, radii, shadows or font sizes in components or rules — use the `:root` custom properties. Add a token rather than a one-off value. Every new token gets a dark-mode value in the `prefers-color-scheme: dark` block.
- Reuse `components/ui.tsx` (`PageHeader`, `Section`, `Field`, `Check`, `NumberInput`, `Chip`, `Callout`, `Empty`, `Loading`, `ErrorBox`, `Live`, `BackLink`, `ExternalLink`) and `components/status.tsx` before writing markup. If a pattern appears on two pages, promote it to `ui.tsx`.

## Tokens (extend, do not replace)
- Colour: `--bg`, `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--brand(-hover/-soft/-contrast)`, semantic `--good/--warn/--bad/--info` each with `-soft`, `--focus`.
- Spacing scale (add if missing): `--space-1..8` = 4, 8, 12, 16, 24, 32, 48, 64 px. Use only these.
- Type scale (add if missing): `--text-xs 12px`, `--text-sm 14px`, `--text-md 16px` (body), `--text-lg 18px`, `--text-xl 22px`, `--text-2xl 28px` (page titles). Line-height 1.5 body, 1.25 headings. Weights 400 / 500 / 600 only.
- Radius: `--radius-sm` inputs/chips, `--radius` cards/dialogs. Shadow: `--shadow` for raised cards, a larger `--shadow-lg` for dialogs/menus only.
- Numbers (scores, prices, counts, dates in tables): `font-variant-numeric: tabular-nums`.

## Colour use
- Brand green for the one primary action per view, active nav, focus accents. Not for decoration.
- Semantic colours carry meaning only: good = suitable/sent/won, warn = needs input/closing soon, bad = error/lost/blocked, info = neutral notices. Always pair colour with text or a symbol (`Chip symbol`) — never colour alone.
- Contrast: body text ≥ 4.5:1, large text and UI borders that convey state ≥ 3:1, in both themes. Check new token pairs before using them.

## Layout
- App shell: sidebar (`--sidebar`) on ≥ 900 px; top bar + slide-out/bottom nav below. Content max-width ~1200 px, centered, 16 px side gutter on phones, 24–32 px on desktop.
- Page anatomy: `PageHeader` (title, one-line intro, actions right-aligned; actions wrap below title on phones) → optional summary stats row → `Section`s.
- Lists: tables on desktop, stacked cards on phones (same data, same order). Never a horizontal page scroll; wide tables scroll inside their own container with a visible edge shadow.
- Detail pages: two columns on ≥ 1100 px (main content + sticky side panel with status, key dates, primary action); one column below with the primary action pinned at the bottom.
- Align to a 4 px grid. Consistent vertical rhythm: `--space-6` between sections, `--space-3/4` inside.

## Components — quality bar
- Buttons: primary (filled brand), secondary (outlined), quiet (text), danger (bad colour, only for destructive). Height 36 px (40 px touch on phones), visible `:focus-visible` ring using `--focus`, `:disabled` looks disabled and has a reason in a tooltip or adjacent text. Busy state shows a spinner and keeps width.
- Inputs: label above, hint below in `--text-muted`, error below in `--bad` with `aria-describedby`. Full width in forms, max ~480 px for single fields.
- Cards: `--surface`, 1 px `--border`, `--radius`, padding `--space-4/5`. Hover lift only on clickable cards.
- Chips/badges: small, rounded, soft background + strong text of the same tone.
- Score display: number + short bar or ring, coloured by decision; always with the decision word.
- Dialogs (`components/Dialog.tsx`): focus trapped, Esc closes, initial focus on the safest action, destructive confirm states the consequence in a full sentence.
- Icons: inline SVG, 16/20 px, `currentColor`, stroke style consistent; decorative ones `aria-hidden`. No emoji as icons.

## Dark mode
- Driven by `prefers-color-scheme`. If a manual toggle is added, store it in localStorage (try/catch) and set `data-theme` on `<html>`; tokens defined for `:root[data-theme=dark]` too.
- Check: borders still visible, soft backgrounds not muddy, shadows replaced by borders, images/logos have a transparent background.

## Motion
- 120–200 ms ease-out for hover, expand, dialog open. No motion that delays work. Respect `prefers-reduced-motion: reduce` (turn transitions off).

## Typography & copy on screen
- System font stack (`--font`); no web font download unless the user asks.
- Sentence case for titles, buttons and labels ("Send application", not "SEND APPLICATION").
- Dates via `useFormat()` in `hooks.ts` (business time zone), never `toLocaleString` directly.

## Done when
`npm run typecheck` passes, `npm run build:web` passes, and the `ui-quality-pass` skill has been run on the changed screens.
