# Design — "The Office": write-side management UI (Round 2)

- **Date:** 2026-07-07
- **Status:** Draft for review
- **Scope:** Round 2 of the UI enhancement. Round 1 (analytics dashboard) is
  done. This round adds the **write/management** screens that let staff operate
  the system through the UI instead of API/scripts.
- **Roadmap position:** This is **Layer 1** of the full college-ERP roadmap
  (`2026-07-07-erp-roadmap.md`) — making the *existing* backend operable via UI.
  New modules (fees, timetable, results/GPA, homework, QR, documents) are
  Layer 2+, each its own later design→plan→build.

## Context

The web UI surfaces only a read-only slice (login, dashboard, student page)
over a ~60-endpoint scope-checked, audited backend. Roughly 40 of those are
write/management endpoints (identity, people, academics, reporting) with **no
screen**. Every write is already authenticated, scope-checked by the
ScopeChecker, and audited; this round is purely a **UI + api-client layer** on
top of them. No new backend endpoints.

## Goal

Add a cohesive `/manage` area — a role-gated shell plus reusable form/table
primitives — covering four functional areas, at the **demo-impact bar** (same
as Round 1): clean screens that clearly work end-to-end through the real
scoped/audited endpoints, covering the happy path and the important
scope/validation/error states, but not exhaustive production hardening.

## Non-goals (this round)

- No new backend endpoints; no changes to the identity security core.
- No concurrent-edit locking, optimistic-UI conflict resolution, bulk undo, or
  an audit-log viewer.
- No new-college creation UI — `bootstrapCollege` stays CLI-only (ratified
  parked decision, docs/review-gate-6.md). The org builder operates **within**
  the caller's existing college.
- No exhaustive client-side validation beyond surfacing the API's problem
  responses; the server remains the source of truth.

## Decisions (from brainstorming)

1. Build **all four** areas (user chose "build all of these"), as one cohesive
   feature with a shared foundation, sequenced in phases.
2. Purpose: **demo-impact**, matching Round 1.
3. A single `/manage` route group with a role-gated nav + shared primitives —
   not screens bolted onto existing pages, not a separate admin app.

## Architecture

### Phase 0 — Shared foundation

- **Manage shell** — a `/manage` route-group `layout.tsx` with a dedicated
  role-gated `ManageNav` component (kept separate from the read-side
  `Masthead`): teachers see the academics-entry links; admin/principal
  additionally see org, people, users, import. Links the caller's scope can't
  use are not rendered (the server still enforces; the UI just doesn't invite
  dead ends). A `/manage` index page routes each role to its most useful screen.
- **Reusable primitives** in `apps/web/src/ui/`:
  - `Field` / `Form` helpers (extend the existing login-form styling) — labelled
    inputs, selects, inline field errors.
  - `DataTable` — a simple headed table with an empty state.
  - `ConfirmDialog` — a minimal confirm for destructive actions.
  - Inline feedback (a `useMutationState`-style hook: idle/saving/error/done)
    reused by every form.
- **`api.ts` mutation helpers** — today `api.ts` is GET-only (`get<T>`) plus a
  bespoke `login`. Add `post<T>`, `patch<T>`, `del<T>` that send the cookie,
  set `content-type: application/json`, and on a non-2xx parse the
  `application/problem+json` body into `ApiError` (status + human message) so
  screens can show inline errors. Add typed wrappers per endpoint used.

### Phase 1 — Area A: Academics entry (the lead; closes the loop)

- **`/manage/attendance`** (class_teacher): choose a section within scope + a
  date → roster grid (from `section-roster`) → set each student
  present/absent/late/excused → submit (`academics.attendance-record`);
  loading an existing session (`attendance-session-get`) allows correction
  (`attendance-correct`).
- **`/manage/marks`** (teacher): choose class + subject within scope → list
  existing assessments (`class-assessments`); create an assessment
  (`assessment-create`: kind/name/maxScore) → score grid per student →
  submit (`marks-enter`); correct a single mark (`mark-correct`).
- After a successful academics write, show a note that analytics updates on the
  next rollup, and (for admins) a **Recompute** button (`analytics.recompute`)
  so the Round-1 dashboard reflects the new data immediately.

### Phase 2 — Area B: Org & people admin (admin)

- **`/manage/org`** — render the college tree (`people.college-tree`); create
  departments/classes/sections/subjects (`*-create`); rename (`org-rename`) and
  delete (`org-delete`, RESTRICT → 409 surfaced as "still has children/
  references").
- **`/manage/students`** — list/create students (`students`, `student-create`);
  enroll into a section (`student-enroll`).
- **`/manage/teachers`** — list/create teachers (`teachers`, `teacher-create`);
  link an identity user (`teacher-link-identity`); create/remove assignments
  (`assignment-create`/`assignment-remove`) — assignments auto-derive scope
  grants (ADR-0015), which the UI notes.

### Phase 3 — Area C: Identity & access admin (admin, security-sensitive)

- **`/manage/users`** — list/create users (`users`, `user-create` with a
  temporary password); set roles (`user-roles`); add/remove scope grants
  (`grants` add/remove) and verify (`grants-verify`); trigger a password reset
  (`user-password-reset` → show the returned token for the demo, matching how
  the seeder provisions accounts).

### Phase 4 — Area D: Bulk import + reports inbox (adjuncts)

- **`/manage/import`** — CSV upload → enqueue a people import
  (`people.import-create`) → poll status/row errors (`people.import-get`).
- **`/manage/reports`** — list the caller's past reports (`reporting.list`) with
  status + a re-download link (`reports/{id}/download`, re-scope-checked
  server-side, as Round 1).

### Data flow & error handling

Client (`/manage/*`) → new `api.ts` mutation methods → existing Next route
handlers → module handlers → ScopeChecker + audit. Same-origin HttpOnly cookie;
the UI holds no privileged path. `401` → `/login`. `403` → a designed "outside
your scope" state. Validation/`409`/`422` → inline error parsed from the
problem+json body. Destructive actions (`org-delete`, `assignment-remove`) go
through `ConfirmDialog`.

## Testing & verification

- **React Testing Library** per screen: a submit calls the correct `api`
  mutation with the right payload; the scope-empty state renders; an `ApiError`
  (403/409) surfaces inline. Follows the existing `dashboard.test.tsx` /
  `login.test.tsx` style.
- **Playwright** drive per role against the seeded college: a class teacher
  records attendance and it appears (after recompute) in the dashboard; an admin
  creates a department/student/user; a teacher enters marks. Screenshot each.
- No backend tests (no backend change), but the integration suite already
  covers the endpoints.

## Sequencing (for the implementation plan)

0. Shell + nav + reusable primitives + `api.ts` mutation helpers.
1. Area A — attendance entry, then marks entry (+ recompute affordance).
2. Area B — org builder, students, teachers/assignments.
3. Area C — users/roles/grants/reset.
4. Area D — CSV import wizard, reports inbox.

Each phase is independently demoable; Phase 1 is the highest-value loop-closer.

## Risks & open questions

- **Scope-aware pickers**: screens need "sections/classes/subjects within my
  scope" to populate dropdowns. The dashboard already derives the caller's nodes
  from grants; reuse that (`analytics.dashboard` tiles / `people` lists filtered
  by scope). Where a clean "my sections" list isn't directly exposed, derive it
  from the caller's grants client-side (same source the dashboard uses).
- **CSV import format**: the exact column schema and error shape come from
  `people.import-create`/`import-get` — the plan will pin them from the code.
- **Recompute latency**: academics writes reflect in analytics only after the
  rollup job; the Recompute button + a "updates shortly" note set expectations.
