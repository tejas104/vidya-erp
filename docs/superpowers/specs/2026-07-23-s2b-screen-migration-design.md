# S2b — Screen migration onto ui-system (Assignment #10, Part 2, slice b)

**Status:** design, awaiting review
**Date:** 2026-07-23
**Parent:** Assignment #10 · sub-project **S2b** of the S2 split. S1 (ui-system, 15 primitives + hex gate) and S2a (7-domain nav + breadcrumbs + Cmd-K search) are complete on `feat/assignment-10-ui-overhaul`.

## Precondition & constraint
- Baseline **e2e 18/18** green; **test:ui 161 / unit 632** green; must stay green.
- **Presentation only.** ZERO changes under any module's `handlers/`, `schema/`, `migrations/`, or platform `auth/`. If a UI need seems to require a backend change → STOP and report as a finding.

## Goal
Migrate the **~27 page screens** off the legacy `@/ui/*` components + `globals.css` classes onto the `@vidya/ui-system` primitives; give every list screen a consistent loading / error-retry / empty state; generalize the student profile into a **SlideOver** opened from any table; and land a **raw-px/scale gate** so spacing/type stay on-scale. Delete each legacy primitive as its last consumer migrates, shrinking the hex-gate ignore-list.

## Scope boundary (user-approved)
- **In S2b:** the 27 `app/**/page.tsx` screens + the student SlideOver + the foundation pieces below.
- **Out of S2b (later cleanup slice):** shared app-shell components (`Sidebar`, `Topbar`, `Masthead`, `Menu`, `NotificationBell`, `Noticeboard`, `DeniedState`, `ReportButton`, `TodayTimeline`) and `charts.tsx`. Their `globals.css` classes (`.cw`, `.td`, `.att`, `.fc`, `.shell`, `.strip`, `.risk`, `.legend`, `.barrow`) stay **ignore-listed** — `globals.css` shrinks a lot but is not fully emptied this slice. Charts are a specialized viz migration (dataviz territory).

## Foundation (built first, in the plan)

### F1 — Raw-px / type-scale gate
Add a sibling script `scripts/check-scale.mjs` (mirrors `check-no-adhoc-hex.mjs`'s structure: same glob, same shrinking ignore-list, forward-slash normalized, build-dirs excluded) wired into `pnpm lint`'s `check:styles` alongside the hex check. It FAILs on, in any `.module.css` outside the ignore-list:
- raw `\d+px` in a `padding` / `margin` / `gap` / `row-gap` / `column-gap` / `inset` value not wrapped in `var(--space-*)`;
- raw `\d+px` in a `font-size` value (must be `var(--text-*)`).
**Allowed** raw px (NOT flagged): `border`/`border-*-width` (hairlines), `border-radius` (though `var(--radius*)` preferred), `width`/`height`/`min-*`/`max-*`/`flex-basis` (dimensions), SVG geometry, `outline`, `letter-spacing`, `transform`/`translate`, animation/transition durations. Implementation parses per-declaration (property → value) so it only inspects the spacing/type properties. Wired into `pnpm lint` alongside the hex check. Same shrinking ignore-list (`globals.css` + not-yet-migrated screens' page modules, emptied as they migrate). Self-tested (inject `padding: 13px` → fails; `var(--space-3)` → passes; `border: 1px` → passes).

### F2 — `AsyncState` page-state wrapper
A small `apps/web/src/ui/AsyncState.tsx` (app-level; consumes ui-system primitives):
```
AsyncState({ loading, error, onRetry, isEmpty, empty, children })
```
- `loading` → renders `Skeleton` rows.
- `error` → an error panel + a `Button` "Retry" calling `onRetry`.
- `isEmpty` (data loaded, zero rows) → renders the `empty` node (an `EmptyState` with a **next-action** button, e.g. "No students yet → Import students").
- else → `children`.
Every migrated **list** screen routes its fetch state through this. One component, tested once; screens pass their states in.

### F3 — Generalized student SlideOver
Refactor `apps/web/src/ui/StudentDrawer.tsx` (289 lines, student-specific) to compose the S1 `@vidya/ui-system` `SlideOver` (focus-trap/ESC/scrim) + `Tabs` with tabs **overview / attendance / marks / fees / documents** (its existing content). **Keep the current data-passing model** (callers already hold the row data) — re-chrome, don't re-architect:
```
StudentSlideOver({ student, canManage?, onClose })   // student: DrawerStudent | null; open = student !== null
```
Swap its bespoke `.cw-scrim`/drawer chrome for the S1 `SlideOver` + `Tabs`; content unchanged. Migrate the two existing callers (attendance, classes) to it, then wire it into the other **student-bearing tables** — fees, results, directory, students — each of which assembles a `DrawerStudent` from its row data (name/roll/section/pct it already renders). Row click / a "view" affordance opens it.
- **Search stays full-page.** The S2a global-search student result keeps routing to `/students/[id]` — search isn't a table and only has id/name/roll (no row data to seed the drawer); forcing a studentId-fetch refactor for it is out of scope. The assignment ties the SlideOver to *tables*. The full-page profile at `/students/[id]` remains for direct links regardless.
- Results respect role scope (the row data + any drawer fetch come from the same scoped endpoints).

## Migration recipe (per screen — the plan applies this in domain batches)
For each `app/**/page.tsx`:
1. Replace `@/ui/{Button,Field,DataTable,Badge,Card,Modal,EmptyState,Skeleton,PageHeader,RingStat,Tabs,Toast,ConfirmDialog}` imports with `@vidya/ui-system` equivalents (`Field`→`Input`/`Select`, `DataTable`→`Table`, `Badge`→`StatusBadge`, `RingStat`→`StatCard`; `ConfirmDialog` composes `Modal`).
2. Move any screen-specific styling into a page-scoped `page.module.css` (token-only, **scale-compliant** — F1 gate enforces), and DELETE that screen's now-freed classes from `globals.css`.
3. Route list fetch state through `AsyncState` (F2): loading skeleton, error+retry, empty+next-action.
4. Keep labels, roles, `aria-*`, form field ids, and e2e-relevant selectors UNCHANGED (the journeys click by text/role/id).
5. Fold in any **S2a-deferred minor** that touches this screen's primitives (e.g. Table `aria-sort` — see `s2a-final-review.md`).

## Delete-as-replaced
Once `grep` shows no `app/**` importing a legacy primitive, delete it from `apps/web/src/ui/` (`Button.tsx`, `Field.tsx`, `DataTable.tsx`, `Badge.tsx`, `Card.tsx`, `Modal.tsx`, `ConfirmDialog.tsx`, `EmptyState.tsx`, `Skeleton.tsx`, `PageHeader.tsx`, `RingStat.tsx`, `Tabs.tsx`, and the legacy `Toast.tsx` if a ui-system Toast provider replaces it) and its tests. `StudentDrawer.tsx` becomes `StudentSlideOver` (F3). App-shell components stay. Each batch shrinks the gate ignore-list by the screens it migrated.

## Plan batching (writing-plans will detail)
Foundation tasks F1–F3 first, then screen migration in domain batches (~2–5 screens each), each an independently-reviewable task that keeps e2e green:
- **B-PEOPLE:** students, teachers, directory, org
- **B-TEACH:** attendance, marks, classes, coursework, my-timetable
- **B-RECORDS:** syllabus, exams, timetable, calendar, results, backlogs
- **B-FCR:** fees, notices, reports
- **B-ADMIN:** leave, users, import, system
- **B-PORTAL:** portal, dashboard, students/[id], manage index
Then a cleanup task: delete freed legacy primitives, shrink the ignore-list, final verification.

## Data flow / error / testing
- No new endpoints; screens keep their existing `api` calls. `AsyncState` standardizes the three states around each fetch.
- Each migrated screen: its existing `*-page.test.tsx` updated to the new primitives (kept meaningful, not weakened); `AsyncState`, `StudentSlideOver`, and the F1 gate each get their own tests.
- **Regression net:** full `test:ui`/`unit` green after each batch; **e2e 18/18** re-run at batch boundaries that touch journey-covered screens (attendance, marks, fees, reports, portal, students) — labels/roles/ids unchanged so journeys hold.

## Verification (S2b exit criteria)
1. `pnpm -r` on S2b surfaces typecheck clean; `test:ui`/`unit` green.
2. **e2e 18/18** on a prod build.
3. `check:styles` (hex + scale) green; no legacy `@/ui/{primitive}` import remains in `app/**` (grep proof); listed legacy primitives deleted.
4. Screenshots: a representative migrated screen per domain + the student SlideOver open, at 1280 & 360.
5. `git diff --stat` shows zero changes under any `handlers/`/`schema/`/`migrations/`/platform `auth/`.

## Risks
- **e2e selector drift** during migration. Mitigation: keep text/role/id stable; e2e is the gate at each journey-touching batch.
- **globals.css shared-class coupling** — a class used by both a migrated screen and a shell component can't be deleted yet. Mitigation: delete a class only when grep shows no remaining consumer; otherwise leave it (ignore-listed) for the cleanup slice.
- **Scope creep into shell/charts.** Mitigation: hard boundary above; shell/charts explicitly out.
- **Batch size / long execution.** Mitigation: domain batches are independently reviewable and keep the suite green, so the branch is always in a mergeable state.

## Out of scope (later)
Shell-component + charts CSS-module migration and fully emptying globals.css (final cleanup slice); PWA/responsive (S3); teacher fast-path (S4); new e2e journeys incl. the SlideOver/search journeys (S5).
