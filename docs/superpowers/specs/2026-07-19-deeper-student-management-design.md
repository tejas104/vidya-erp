# Deeper Student Management — Design

**Date:** 2026-07-19
**Status:** Approved (owner, 2026-07-19)
**Scope:** Three student-management slices, built subagent-driven.

## Context

Student management today:
- `/manage/students` — section-scoped roster with add/enroll, transfer, link sign-in, edit
  profile (phone/guardian/DOB), and a lifecycle-status dropdown. Section-bound: *"there is no
  global list — students live in sections."*
- `/students/[studentId]` — a thin performance page (attendance trend + marks-by-subject, via
  `api.studentPerformance`). No identity/guardian block, no documents; predates the token rebrand.

Backend already in place (no new modules needed):
- `people.student-get` — `GET /students/{id}`, `ANY_AUTHENTICATED`, scope-checked at the student's
  org position, returns the full `studentViewSchema` (admission no, status, enrollment, profile).
- `people.student-documents` list + `documents/{id}/download`.
- `people.student-enroll` — `POST /students/{id}/enrollment`, `ADMIN_OR_CLASS_TEACHER`, withdraws
  the year's live enrollment and re-enrolls; scope-checked against **both** source and target
  section (covers the class-teacher promotion clause).
- `people.student-update` — `PATCH /students/{id}`, for status / profile edits.

## Working agreements (hold these)

Ponytail (reuse before build, no new runtime deps); real endpoints only + five states
(loading/empty/error/denied/withheld); both themes from tokens; **the ScopeChecker is
human-owned — no changes here** (all three slices reuse existing auth or the row-filter pattern);
live-verify against the real DB. No screenshot tooling — visuals are owner-verified.

---

## Slice A — Rich student profile page

**File:** `apps/web/app/(app)/students/[studentId]/page.tsx` (rewrite/extend).

Keep the existing performance content (attendance stat + trend, marks-by-subject) — it already
loads via `studentPerformance`. Add, loaded in parallel:

- **Profile header** from `people.student-get`:
  - avatar — the student's `photo` document if present (reuse the drawer's photo→avatar approach),
    else a monogram;
  - admission no., lifecycle-status badge, current section + academic year;
  - phone, DOB, guardian name + guardian phone.
  - Honest **withheld** rendering for any null field; if `student-get` 403s, show the same
    "outside your scope" state the performance load already uses.
- **Documents block** — list from `GET /students/{id}/documents` with per-row download
  (`documents/{id}/download`). Read-only on this page (upload stays in the workspace / students
  admin). Empty state when none.
- Restyle to the current token system; drop the "Back to the register" copy.

**Client:** add `api.getStudent(id)` (thin GET wrapper over `people.student-get`). Document
list/download clients already exist (drawer).

**No backend change. No scope-checker change.**

## Slice B — College-wide student search

**New read route** `people.student-search`:
- `GET /api/v1/people/students/search?collegeId={id}&q={q}`
- `ANY_AUTHENTICATED`.
- Response `{ students: [{ id, admissionNo, fullName, status, sectionLabel: string | null }] }`.
- Results **row-filtered by the caller's read scope** — reuse the established pattern
  (`sectionRosterAttendance`, `section-corrections`): admin / principal / hod / accountant get
  college-wide; a subject teacher sees only students in sections they can read. **No
  scope-checker change.**

**Repo** `searchStudents(collegeId, q)`:
- ILIKE on `full_name` and `admission_no` (`%q%`), scoped to `collegeId`.
- Left-join the current-year live enrollment → section → class to build `sectionLabel`
  (`"<Class> · Sec <Section>"`, null if not enrolled).
- Cap results (~50). No migration.

**UI** on `/manage/students`: a debounced search box above the section picker. A non-empty query
shows a result list (admission no. · name · class·sec · status) with each row linking to
`/students/{id}`; clearing the box returns to the section browser. Loading + empty
("No students match.") states.

**Client:** `api.searchStudents(collegeId, q)`.

## Slice C — Year-end promotion / bulk actions

**Reuse `people.student-enroll`** — no new backend.

- **"Promote section" modal** on `/manage/students`: pick target section + next academic year →
  iterate the current section's **active** students, calling `enrollStudent(id, {sectionId,
  academicYear})` for each. Show a summary: N promoted, M skipped/failed with reasons (e.g. a 403
  from a cross-class target when the caller isn't admin).
- **"Graduate section → alumni"** action: iterate `updateStudent(id, {status:"alumni"})` over the
  active roster, with the same summary.

**Auth reality:** cross-class promotion (FY→SY) is **admin-only** — a class-teacher's target
section fails the enroll scope check by design. The modal surfaces this via the per-student
failure summary rather than pretending otherwise.

**Ponytail ceiling:** client-orchestrated N calls, not one transaction. Mark with a `ponytail:`
comment + upgrade path — a transactional `POST /sections/{id}/promote` if partial-failure ever
bites. Acceptable for an on-prem, admin-initiated, once-a-year action.

---

## Task breakdown (subagent-driven)

| Task | Touches | Depends on |
|------|---------|-----------|
| **A** Rich profile page | `students/[studentId]/page.tsx`, `api.ts` (getStudent) | — |
| **B** Student search | people `definition.ts` / `handlers.ts` / `repo.ts`, `api.ts`, `manage/students/page.tsx` | — |
| **C** Promotion / bulk | `manage/students/page.tsx`, `api.ts` | **B** (same files) |

- **A** is independent → runs in parallel.
- **B → C** run sequentially (both edit `manage/students/page.tsx` + `api.ts`).
- Each task: implementer + reviewer per the subagent-driven-development flow; final opus review.

## Verification

- Unit/UI: search result rendering; profile page states (ok / withheld / 403 / 404); promotion
  summary. `npx vitest run --project unit --project ui` (currently **715** passing).
- Integration (real DB): a search-flow test proving the row-filter (admin sees cross-section,
  a subject teacher does not); reuse the enroll integration coverage for promotion.
- After route change: `pnpm openapi:generate`; `pnpm --filter @vidya/web build`.
- Reseed clean; **owner eyeballs** the profile page, search box, and promotion modal (no
  screenshot tooling here).

## Explicitly out of scope

- No transactional bulk-promote endpoint (ponytail ceiling above).
- No new scope-checker grants or conformance-matrix changes.
- No document upload on the profile page (stays in workspace / students admin).
- No search-as-its-own-page (lives on `/manage/students`).
