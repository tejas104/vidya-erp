# Design — Vidya app shell + design system (Round 3, sub-project 1)

- **Date:** 2026-07-07
- **Status:** Draft for review
- **Roadmap position:** First sub-project of the "Zoho-level frontend" program.
  Everything else — Area B (org/people admin), the student portal, and future
  modules — is built *inside* this shell. See
  `2026-07-07-erp-roadmap.md` and `2026-07-07-manage-ui-design.md`.

## Context

Vidya's UI today is a set of centred, editorial single pages (`/login`,
`/dashboard`, `/students/[id]`, `/manage/*`), each rendering a bare `Masthead`.
It has a genuinely distinctive identity (the `vidya.` wordmark, display
headings, a paper/chalk theme, hand-rolled SVG charts) but lacks the structure
of a complete app: no persistent navigation, no shared component vocabulary
(each screen re-implements forms/rows inline), no modals/toasts/tables kit.

## Goal

Build a **Zoho-level app shell + hand-rolled design system** that keeps Vidya's
editorial identity but adds the completeness of a real product: a persistent
role-aware sidebar + topbar, a reusable component kit, and consistent design
tokens across light (paper) and dark (chalk). Re-home the existing screens into
the shell so the whole app immediately feels coherent and polished.

## Non-goals (this sub-project)

- **No new endpoints / no backend changes.** Shell reads only `api.session()`.
- **No new dependencies** — hand-rolled kit (ADR-0009); the `frontend-design`
  skill guides polish during implementation.
- **No new feature screens** — Area B (org/people admin) and the student portal
  are separate later sub-projects built inside this shell.
- No change to the content/logic of the re-homed screens beyond wrapping them in
  the shell + `PageHeader` and, where it clearly improves UX, swapping inline
  save-feedback for `Toast`.

## Decisions (from brainstorming)

1. Build the shell/design-system **first**; Area B and student portal follow.
2. Student access will be a **real portal with new auth** — its own later
   sub-project (not in this spec).
3. Aesthetic: **keep Vidya's editorial identity, elevated to Zoho
   completeness** — not a generic corporate clone.
4. Component kit is **hand-rolled** (no UI library), themed paper + chalk.

## Architecture

### A. Shell & routing

- Introduce a shared authenticated layout via a Next.js **route group**
  `apps/web/app/(app)/layout.tsx` that renders the shell once
  (`<AppShell>` = sidebar + topbar + content slot). `/login` stays outside it.
- **Move** the existing routes under the group so they inherit the shell:
  `app/dashboard` → `app/(app)/dashboard`, `app/students/[studentId]` →
  `app/(app)/students/[studentId]`, `app/manage/*` → `app/(app)/manage/*`. Their
  page *content* is unchanged; the per-page `<Masthead>` is removed (the shell
  provides chrome). Route-group folders don't change URLs, so links stay valid.
- The `(app)/layout.tsx` fetches `api.session()` once, centralises `401 →
  /login`, and passes `roles`/`displayName` to the shell. A loading skeleton
  shows until the session resolves.

### B. Role-aware navigation

- A single `navConfig` (one array of `{ href, label, icon, group, roles }`).
  `Sidebar` renders only entries whose `roles` intersect the caller's roles —
  the server still enforces every action; the nav only avoids dead ends.
- Groups: **Overview** (Dashboard — all) · **Teaching** (Attendance — class
  teacher; Marks — teacher) · **Insight** (Analytics/rollups, At-risk — hod,
  principal, admin) · **Administration** (Organisation, Students, Teachers,
  Users, Import — admin) · **Reports** (all). Empty groups are omitted.

### C. Hand-rolled component kit (`apps/web/src/ui/`)

Small, focused, single-responsibility files, themed via CSS custom properties:

- **Shell:** `AppShell`, `Sidebar` (+ mobile drawer), `Topbar` (wordmark,
  academic-year context, user menu), `PageHeader` (title + optional
  breadcrumb + action slot).
- **Primitives:** `Button` (primary/ghost/danger, sizes, loading),
  `Field`/`Input`/`Select`/`Textarea` (label + hint + error), `DataTable`
  (columns, empty state, optional row actions), `Card`, `Badge`/`Chip`,
  `Modal` (portal, hand-rolled focus-trap, Esc-to-close, `aria-modal`), `Menu`
  (dropdown, roving focus, Esc/outside-click close), `Tabs`, `Toast` provider +
  `useToast()`, `EmptyState`, `Skeleton`, and `ConfirmDialog` (built on `Modal`).
- **Tokens (`globals.css`):** extend the existing custom properties into a
  fuller scale — spacing steps, radii, elevation/shadows, and semantic surfaces
  (`--surface`, `--surface-2`, `--sidebar-bg`, `--border`, `--text`, `--muted`,
  status colours) — defined for both `:root` (paper) and the chalk theme so the
  sidebar, tables and modals theme correctly.

### D. Re-home existing screens

- Dashboard (Round 1 multi-graph), student page, and the two `/manage` entry
  screens render inside the shell with a `PageHeader`. The `ManageNav` I built
  is superseded by the sidebar's Administration/Teaching groups (remove it).
- Prefer `Toast` for mutation success/error on the manage screens where it reads
  better than the current inline span; keep inline field errors.

### E. Data flow, responsive, accessibility

- No new endpoints. `api.session()` drives the nav + user menu; `api.logout()`
  from the user menu. `401 → /login` centralised in `(app)/layout.tsx`.
- **Responsive:** sidebar is persistent ≥ ~960px and collapses to a
  hamburger-triggered drawer below; page bodies use the existing `.page`
  max-width inside the content column; wide tables scroll in their own
  `overflow-x` container.
- **A11y:** `Modal` and `Menu` implement focus trap / roving focus, Esc, and
  outside-click; visible focus rings (already in `globals.css`); the sidebar is
  a labelled `<nav>`; skip-link retained.

## Testing & verification

- **RTL:** `Sidebar` (renders only role-permitted groups; a teacher sees
  Teaching not Administration), `Modal` (focus trap + Esc close + returns focus),
  `Toast` (show + auto/'manual dismiss), `DataTable` (rows + empty state),
  `Topbar` (theme toggle flips `data-theme`; sign-out calls `api.logout`).
- **Regression:** the re-homed `dashboard.test.tsx` / manage screen tests still
  pass with the new layout wrapper (adjust imports/paths only).
- **Playwright:** drive the shell as principal, class teacher, teacher — confirm
  the sidebar shows the right groups, a modal opens/traps focus, a toast fires,
  and the dashboard + attendance/marks screens still work inside the shell.
  Screenshot each; verify light + dark.
- The **frontend-design** skill guides the visual system (type scale, spacing,
  colour, density) during implementation.

## Risks & open questions

- **Layout refactor touches working screens.** Moving 4 pages into `(app)/` and
  removing per-page `Masthead` is mechanical but must not change their behaviour;
  regression tests + Playwright cover this.
- **Icons.** A sidebar wants icons; to stay dependency-free, use a small set of
  inline SVG icons (hand-rolled, like the charts) rather than an icon package.
- **Scope creep.** The temptation is to redesign each screen's internals; this
  sub-project only re-homes them. Deeper per-screen redesign is a follow-up.

## Sequencing (for the implementation plan)

0. Design tokens (extend `globals.css`) + inline icon set.
1. Core primitives: `Button`, `Field`/`Input`/`Select`, `Card`, `Badge`.
2. Overlay primitives: `Modal` (+ focus trap), `Menu`, `Toast` provider,
   `ConfirmDialog`.
3. `DataTable`, `PageHeader`, `EmptyState`, `Skeleton`, `Tabs`.
4. `Sidebar` (role-aware) + `Topbar` + `AppShell`.
5. `(app)` route group + move the 4 existing pages under it; wire the shell.
6. Swap manage-screen feedback to `Toast`; remove `ManageNav`.
7. RTL + regression + Playwright (light + dark) per role.
