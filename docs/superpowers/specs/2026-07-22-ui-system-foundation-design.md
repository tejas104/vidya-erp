# S1 — `packages/ui-system` foundation (Assignment #10, Part 1)

**Status:** design, awaiting review
**Date:** 2026-07-22
**Parent:** Assignment #10 (UI overhaul). This is sub-project **S1** of five
(S1 foundation → S2 migration+IA/nav → S3 responsive+PWA → S4 teacher
fast-path → S5 e2e guards). Each sub-project gets its own spec/plan/impl cycle
and must leave the 18-journey Playwright net green.

## Precondition (met)
Baseline e2e is **18/18 green** against a prod build with the worker running
(see [[e2e-run-recipe]]). Any UI work must keep it green.

## Hard constraint (all of #10)
Presentation/navigation only. **Zero** edits under any module's `handlers/`,
`schema/`, `migrations/`, or platform `auth/`. If a UI need appears to require
a backend change, STOP and report it as a finding — do not make the change.

## Problem
The current "design system" is [apps/web/app/globals.css](../../../apps/web/app/globals.css)
— **1758 lines** of class-based styling (`.btn`, `.ui-table`, `.card`) plus
page-specific namespaces (`.cw-*`, `.td-*`, `.fc-*`, `.login-*`), carrying **two
competing `:root` token sets** (the original "Register" values, then overridden
in source order by a cool-navy "reference" set). Components live in
[apps/web/src/ui/](../../../apps/web/src/ui/) but pull styling from this global
sheet, so styles are neither encapsulated nor collision-safe, and "no ad-hoc
styling" is unenforceable.

## Goal of S1
Stand up `packages/ui-system` as the single styling foundation: one token
source + the standardized primitives, each with encapsulated CSS Modules. Prove
parity by porting exactly **one** screen onto it and deleting that screen's old
classes. The remaining ~27 screens migrate in S2.

## Decisions (locked with the user)
1. **Full literal rebuild** — build the package from scratch; delete old
   `apps/web/src/ui` components as each is replaced (delete-as-replaced, no dead
   code, honest `git diff`). **In S1 specifically** this means deleting only what
   the ported login screen frees up — its bespoke `.login-*` classes in
   `globals.css`. Shared components (Button, Field, …) stay until the last screen
   importing them migrates in S2; that is when they get deleted.
2. **Tokens stay CSS custom properties**, owned by the package
   (`tokens.css`), not TS objects.
3. **CSS Modules per component** consuming `var(--token)` — real encapsulation;
   makes "no ad-hoc styling" grep-enforceable.

## Package shape
```
packages/ui-system/
  package.json          name: @vidya/ui-system; peerDeps react/react-dom;
                        "exports": { ".": "./src/index.ts", "./tokens.css": "./src/tokens.css" }
  tsconfig.json         extends repo tsconfig.base
  src/
    tokens.css          the ONE token source (see below)
    index.ts            barrel export of every primitive + types
    Button/    Button.tsx    Button.module.css
    Input/     Input.tsx     Input.module.css
    Select/    Select.tsx    Select.module.css
    DatePicker/DatePicker.tsx DatePicker.module.css   (native <input type="date">)
    Table/     Table.tsx     Table.module.css
    StatusBadge/ StatusBadge.tsx StatusBadge.module.css
    Card/      Card.tsx      Card.module.css
    SlideOver/ SlideOver.tsx SlideOver.module.css      (generic right drawer)
    Modal/     Modal.tsx     Modal.module.css
    Toast/     Toast.tsx     Toast.module.css          (+ ToastProvider/useToast)
    Tabs/      Tabs.tsx      Tabs.module.css
    EmptyState/EmptyState.tsx EmptyState.module.css
    Skeleton/  Skeleton.tsx  Skeleton.module.css
    PageHeader/PageHeader.tsx PageHeader.module.css
    StatCard/  StatCard.tsx  StatCard.module.css        (gradient ring variant)
```
`@vidya/web` gains `@vidya/ui-system: workspace:*`. Next `transpilePackages`
already covers workspace packages (verify in `next.config.ts`); CSS Modules from
a workspace package are supported by Next 16.

## Token layer (`tokens.css`)
- **Collapse the two `:root` blocks into one.** The cool-navy "reference" set is
  what currently renders (it overrides by source order), so it wins; the older
  Register duplicates are dropped. Keep the full dark-mode story: both
  `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and
  `:root[data-theme="dark"]` (explicit toggle wins both directions).
- **Type scale — fixed:** define `--text-12 --text-14 --text-16 --text-20
  --text-24 --text-32`. These are the ONLY sizes primitives may use. (Current
  CSS uses arbitrary sizes like 14.5px/12.5px — those get snapped to the scale.)
- **Spacing — fixed:** reuse existing `--space-1..7` = 4/8/12/16/24/32/48. Only
  these.
- **Color:** neutral surfaces (`--paper*`, `--surface*`, `--rule*`), ink
  (`--ink`, `--ink-2`, `--ink-3`), and **status-only** color
  (`--good/--warn/--bad/--brand` + `-soft`). No pastel surface fills. Status is
  never color-alone — primitives that signal status (StatusBadge, Toast) always
  pair color with an icon or label.
- **Figures:** `--font-figure` (IBM Plex Mono) for roll numbers, amounts,
  percentages, table dates. `--font-sans` (Inter) for UI text.
- **Density:** table row height 40px; forms roomier.
- `tokens.css` is the **only** file permitted to contain raw hex values —
  the Part-3 grep proof asserts no hex outside it.

## Primitive specs (parity + gaps)
Props stay close to the current components so S2 migration is mechanical.

| Primitive | Replaces | Notes / API |
|---|---|---|
| Button | `Button.tsx` | `variant: primary\|secondary\|danger\|ghost`, `size`, `disabled`, `loading` |
| Input | `Field.tsx` (input) | label, hint, error, `type` |
| Select | `Field.tsx` (select) | label, hint, error, options |
| DatePicker | — (new) | native `<input type="date">`, styled; no dependency |
| Table | `DataTable.tsx` | sortable headers, sticky header, compact (40px rows), `overflow-x:auto` wrapper |
| StatusBadge | `Badge.tsx` | `status: good\|warn\|danger\|neutral\|info` + required icon/label (never color-alone) |
| Card | `Card.tsx` | surface panel, optional header |
| SlideOver | generalize `StudentDrawer.tsx` | generic right drawer: `open`, `onClose`, `title`, focus-trap, ESC, scrim. StudentDrawer becomes a consumer that composes SlideOver + tabs |
| Modal | `Modal.tsx` / `ConfirmDialog.tsx` | centered dialog, focus-trap; ConfirmDialog composes it |
| Toast | — (new component) | `ToastProvider` + `useToast()`; renders the existing `.ui-toast` visual; status + icon |
| Tabs | `Tabs.tsx` | keyboard-navigable |
| EmptyState | `EmptyState.tsx` | title + body + **next-action button** slot |
| Skeleton | `Skeleton.tsx` | shimmer loader |
| PageHeader | `PageHeader.tsx` | title + breadcrumb slot + actions slot |
| StatCard | `RingStat.tsx` | figure + label; gradient-ring variant (structural gradient only) |

Non-primitive, app-specific components (Sidebar, Masthead, Menu, NotificationBell,
Noticeboard, StudentCard, DeniedState, charts) are **not** part of S1 — they
stay in `apps/web/src/ui` for now and get restyled in S2 as they migrate onto
these primitives.

## Proof-of-parity screen
Port **the login screen** ([apps/web/app/login/page.tsx](../../../apps/web/app/login/page.tsx))
onto the package: it uses Button + Input today, is exercised by every e2e
journey (all log in), and its bespoke `.login-*` classes are self-contained —
so deleting them from `globals.css` and rebuilding the screen from primitives +
one page-scoped module is a clean, low-risk first cut. Dashboard is the fallback
if login's split-hero proves too bespoke to express as primitives in S1.

## Verification (S1 exit criteria — evidence, not intent)
1. `pnpm -r typecheck` passes including the new package.
2. Full e2e stays **18/18 green** (prod build + worker), proving the ported
   login screen still works through the real router.
3. Ported screen renders correctly at **1280px and 360px** (screenshots).
4. `grep` proof: the ported screen imports only `@vidya/ui-system` for UI, and
   no hex values exist outside `tokens.css` for the code S1 touches.
5. `git diff --stat` shows **zero** changes under any `handlers/`, `schema/`,
   `migrations/`, or platform `auth/`.

## Out of scope for S1 (later sub-projects)
Migrating the other 27 screens, nav regrouping to 7 domains, breadcrumbs,
global search, student SlideOver-from-tables (S2); responsive pass + PWA (S3);
teacher fast-path (S4); new e2e journeys (S5).

## Risks
- **Login is bespoke** (split gradient hero). Mitigation: fallback to dashboard
  as the proof screen; the hero can be a page-scoped module, not a primitive.
- **CSS Module + workspace-package interop in Next 16.** Mitigation: verify
  `transpilePackages`/`output: standalone` handles it in the first build; the
  build already emits standalone, so confirm the package's CSS is traced.
- **Token collapse regressions.** Mitigation: the collapse keeps the
  currently-rendering values; e2e + screenshots catch visual breakage on the
  ported screen. Full visual coverage comes as screens migrate in S2.
