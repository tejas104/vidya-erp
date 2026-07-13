# M7 — Staff leave (approvals only) — design

**Date:** 2026-07-14
**Milestone:** M7 (Phase 5 of the ERP master plan v2)
**Pattern:** same four-step module shape as M6 Exams (contract → frontend → backend → integration).

## Brief

The **leave register**. Two jobs:
- **Teacher** — apply for leave and know where it stands.
- **HOD / principal** — approve or reject with a reason.

Messaging threads and complaints are explicitly cut (colleges use phone/WhatsApp; the ERP part is the approval trail).

## Key decision — how a request gets its department (Approach A)

Teachers have **no home department**: a teacher's department(s) come from their
teaching assignments (`ppl_teacher_assignments` → subject/class → department) and
can span several. Approval must route to the applicant's HOD, so each request
carries a department.

**Chosen (A): derive from assignments at apply time.** The server resolves the
teacher's departments from `assignmentsByTeacher` (distinct `departmentId`):
- exactly one → stamp it automatically;
- several → the apply modal requires the teacher to pick one of *their* departments;
- none (unassigned teacher) → `department_id` is null = a college-level request the principal decides.

Adds one small `PeopleDirectory.teacherDepartments()` read reusing existing repo
data. No schema change to `ppl_teachers`, no CSV-import change, no backfill.

**Rejected (B): a home `department_id` column on `ppl_teachers`.** Cleaner data
model, but ripples across the people module (migration, teacher-create UI, CSV
import `department_code`, seed, backfill of existing teachers) — scope creep into
a critical path for a leave feature. If a real teacher home-department is wanted,
it earns its own milestone.

## Contract

### Table — `lvs_requests`

| column         | type / notes                                                            |
|----------------|-------------------------------------------------------------------------|
| id             | text pk                                                                  |
| college_id     | text, not null → college                                                 |
| department_id  | text, **nullable** (null = college-level, principal-decided)             |
| teacher_id     | text, not null → the applicant (opaque link, no FK per rule 2)           |
| from_on        | date, not null                                                           |
| to_on          | date, not null                                                           |
| kind           | text, not null — `casual` \| `sick` \| `duty`                            |
| reason         | text, not null                                                           |
| status         | text, not null, default `pending` — `pending` \| `approved` \| `rejected` |
| decided_by     | text, nullable (identity user id of the approver)                        |
| decided_at     | timestamptz, nullable                                                    |
| decision_note  | text, nullable (required on reject)                                      |
| created_at / updated_at | timestamptz                                                    |

Table prefix `lvs_`. CHECK `from_on <= to_on`. Index on `(college_id, status)` and
`(department_id, status)` for the approver queues; index on `teacher_id` for the
self view.

### Routes

- **`leave.apply`** — `POST /api/v1/leave/requests`. Auth = any authenticated
  staff (non-student); resolves the applicant via `teacherByIdentityUser`
  (404 if the sign-in is not linked to a teacher). Body
  `{ fromOn, toOn, kind, reason, departmentId? }`. Server resolves the teacher's
  departments: requires `departmentId` (and validates membership) only when the
  teacher has >1; auto-fills when exactly 1; null when 0. Status starts `pending`.
  Audited `leave.applied`. 422 if `toOn < fromOn` (defence-in-depth over the CHECK).
- **`leave.my-requests`** — `GET /api/v1/leave/mine`, teacher self. Own requests,
  newest first, with status.
- **`leave.pending-for-me`** — `GET /api/v1/leave/pending`, HOD/principal. Pending
  requests the caller's grants cover (see scope rule). Newest first, teacher names
  resolved via the directory.
- **`leave.decide`** — `POST /api/v1/leave/requests/{requestId}/decide`,
  HOD/principal, audited `leave.decided`. Body `{ status: approved|rejected, note? }`.
  Reject **requires** a non-empty note (422 otherwise). Sets `decided_by`,
  `decided_at`, `decision_note`.

### Scope rule (reused, not new)

Authorization uses the existing `Principal.grants[].org` model exactly like
notices/analytics — no new scope primitive.

A request is **visible/decidable** by a caller iff some grant covers it:
- an HOD grant (`org.departmentId` set) matches the request's `department_id`; or
- a principal/college grant (college matches, no departmentId) covers any request
  in that college.

Denials (fail closed):
- applicant deciding their **own** request → 403;
- HOD deciding a request **outside their department** → 403;
- deciding an **already-decided** request → 409;
- non-staff (student) on any leave route → 403 via role policy.

Admins: treated as college-wide approvers (same as a principal grant).

## Screens

`/manage/leave` — **role-adaptive**, one route:

- **Teacher view:** "Apply for leave" opens a Modal — native `<input type="date">`
  from/to, kind `<select>`, reason textarea, and a department `<select>` that
  appears **only** when the teacher has more than one assigned department. Below,
  a "My requests" `DataTable`: dates, kind, status Badge (pending = warn,
  approved = good, rejected = accent), decision note revealed on row expand for
  rejected/approved rows.
- **HOD / principal view:** the same page shows an **Approvals** section on top —
  a pending `DataTable` (teacher, dates, kind, reason) with **Approve** / **Reject**
  actions; Reject opens a small note prompt (note required, submit disabled until
  filled). Below that, their own "My requests" table (an HOD can also apply).

**Dashboard card** (HOD/principal): "N leave requests waiting" → links to the
approvals section. Hidden when zero.

## Composition & integration

- Wire `createLeaveModule` into `apps/web/src/composition.ts` and
  `apps/worker/src/main.ts` (no jobs — parity only, like notices), add to the
  module arrays, and register `leaveModuleDefinition` in `scripts/registry.ts`
  (migrations).
- New `PeopleDirectory.teacherDepartments(teacherId): Promise<string[]>` (distinct
  department ids from the teacher's assignments), implemented in the people module
  and added to the test fakes that implement `PeopleDirectory`.
- Seed: a pending request and a decided (approved) request for demo teachers, so
  the HOD sees a live queue and a teacher sees a resolved one. Drive
  teacher-apply → HOD-approve through the real scoped/audited route chain.

## Tasks (merge-train order)

- **L1 — Contract.** `lvs_requests` schema types, route specs, module definition,
  `teacherDepartments` directory method signature. Commit.
- **L2 — Frontend.** api block, `/manage/leave` (role-adaptive sections), dashboard
  card; RTL: teacher vs HOD render, reject-note-required, empty states. Commit.
- **L3 — Backend.** schema/migration/repo/handlers; `teacherDepartments`
  implementation; denial unit tests (own-request 403, HOD-outside-dept 403,
  already-decided 409, reject-without-note 422). Commit.
- **L4 — Integration.** wiring (web/worker/registry), fakes updated, seed
  pending+decided, drive teacher-apply → HOD-approve, live-verified. Merge.

## Out of scope (YAGNI)

- Leave balances / quotas / accruals — this is an approval trail, not payroll.
- Half-day / hourly leave — whole-day date ranges only.
- Overlap detection between a teacher's requests — allowed; no guard.
- Cancellation/withdrawal of a submitted request — add only if asked.
- Notifications/emails on decision — the status badge is the channel.
- Teacher home-department model (Approach B) — separate milestone if wanted.
