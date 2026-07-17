# Teacher Profiles — design

**Date:** 2026-07-17
**Status:** approved (owner chose surface = self-service edit; auth mechanism = A)
**Parallels:** student 2.5 profile depth (`ppl_students` phone/guardian/dob, `studentProfilePatchSchema`, students-page Edit-profile modal).

## Goal
Give teacher records real profile depth and let a teacher **view and edit their own**
profile. Admin can also edit any teacher's depth. Photo/avatar upload is **deferred**
(monogram stays) — a later turn can reuse the `ppl_student_documents`/MinIO pattern.

## Fields (all nullable, all teacher-editable)
Added to `ppl_teachers`:

| column | type | validation |
|---|---|---|
| `phone` | text | `phoneSchema` (existing, 3–20 chars) |
| `email` | text | new `emailSchema` = `z.string().trim().email()` |
| `designation` | text | 1–80 chars (free text: "Assistant Professor" etc.) |
| `qualification` | text | 1–120 chars ("M.Sc, Ph.D") |
| `dob` | date (`mode:"string"`) | `dobSchema` (existing ISO `YYYY-MM-DD`) |
| `date_of_joining` | date (`mode:"string"`) | `dobSchema` (reused ISO date) |
| `about` | text | 0–1000 chars, one textarea |

`staffNo`, `fullName`, `status`, `identityUserId` stay **admin-owned** — never in the
teacher-editable patch.

## Data / migration
`packages/modules/people/migrations/0005_teacher_profile.sql` — `ALTER TABLE ppl_teachers
ADD COLUMN` the 7 nullable columns. Mirror the drizzle schema (`pplTeachers`) with the
same field names (camelCase → snake_case).

## Schema & view
- New `teacherProfilePatchSchema` in `definition.ts` (parallel to `studentProfilePatchSchema`):
  each field `.nullable().optional()`.
- New `emailSchema` alongside `phoneSchema`/`dobSchema`.
- Extend `teacherViewSchema` with the 7 fields.
- Extend `teacherView()` in `handlers.ts` to map them.
- Repo `updateTeacher` patch type + set-clause: extend to accept the profile fields
  (currently only `fullName`/`status`/`identityUserId`).

## Endpoints
1. **`GET /api/v1/people/teachers/me`** *(new)* — `ANY_AUTHENTICATED`.
   Resolves the caller's own record via the existing
   `findTeacherByIdentityUser(principal.id)`. Returns `teacherViewSchema`.
   **404** (honest empty) if no linked staff record. No scope check — self by construction.
2. **`PATCH /api/v1/people/teachers/me`** *(new)* — `ANY_AUTHENTICATED`.
   Same resolution. Body = `teacherProfilePatchSchema` **only** (refine: ≥1 field). Cannot
   touch name/status/staffNo. Audited (`people.teacher-updated`, resourceId = own id).
   No scope check — you can only ever address your own record.
3. **`PATCH /api/v1/people/teachers/{teacherId}`** *(extend)* — existing admin route.
   Extend body with `.merge(teacherProfilePatchSchema)`. Stays `ADMIN_ONLY` +
   scope-checked exactly as today. Grant re-sync on status change unchanged.

`pnpm openapi:generate` after route changes.

## Auth decision — Approach A (owner-approved)
The self-edit is a **write**; the Constitution's self-access exception
(`scope-checker.ts:130`) is deliberately **read-only**. Approach A lands the policy
**without touching the human-owned ScopeChecker or grant matrix**: the `/me` routes
resolve the caller's *own* record from `principal.id`, so there is no "which record"
to scope — authority is trivially self-ownership, the same construction as student
`portal/me`. scope-checker.ts stays byte-identical.

- **Flagged policy for the owner:** "a linked teacher may edit their own profile fields
  (phone/email/designation/qualification/dob/date_of_joining/about) via `/teachers/me`."
  Recorded in the conformance-matrix notes; no matrix grant row changes because the
  ScopeChecker is not consulted on the `/me` path.
- Rejected alternative **B** (widen ScopeChecker self-access to `update` on a
  `teacher-profile` resourceType) — keeps auth centralized but edits the shared checker
  every feature depends on. Not taken.

Defense-in-depth: the `/me` PATCH handler binds the body to `teacherProfilePatchSchema`
so even a malformed client can't set name/status.

## Web surface
- **`/manage/profile`** *(new page, "My profile")* — nav for `teacher · class_teacher ·
  hod`. Loads `GET /teachers/me`; renders a view + inline edit form of the 7 fields.
  Five states: loading (Skeleton) / empty i.e. all-blank (prompt to fill) / **404 →
  honest "No staff profile is linked to your account."** / error / saving. `PATCH
  /teachers/me` on save; toast on success. `<input type="date">` for both dates, textarea
  for about, `type="email"`/`type="tel"` inputs. Both themes from tokens, `:focus-visible`,
  reduced-motion respected.
- **`/manage/teachers` admin Edit-profile modal** — an "Edit profile" button per teacher
  row opening a modal with the 7 fields (+ existing name/status), `PATCH
  /teachers/{id}`. Parallel to the students-page modal.
- **api.ts** additions: `getMyTeacher()`, `updateMyTeacher(patch)`, and extend
  `updateTeacher(id, patch)` typing + `TeacherView` type with the 7 fields.

## Testing (real endpoints, live-verify)
- **people-service / handlers unit test:** `/me` GET resolves by identity link; `/me`
  PATCH updates only profile fields and 404s when unlinked; admin PATCH accepts profile
  fields; profile patch rejects name/status keys (schema).
- **Integration (real DB):** a linked teacher reads + patches own profile (200); an
  identity user with no teacher record gets 404 on `/me`. Reseed and confirm columns.
- **UI test:** `/manage/profile` renders the four non-happy states + a successful save.
- Run: `npx vitest run --project unit --project ui`; integration with
  `INTEGRATION_RESET_DB=true`; `pnpm openapi:generate`; `pnpm --filter @vidya/web build`.

## Seed
Backfill the ~6 seeded teachers with realistic phone/email/designation/qualification/
dob/date_of_joining/about so the profile page isn't blank in the demo.

## Out of scope (deferred)
- Photo / document upload (avatar) — later turn, reuse MinIO document pattern.
- HOD/principal/admin viewing *other* staff profiles beyond the existing admin management
  page — not requested.
