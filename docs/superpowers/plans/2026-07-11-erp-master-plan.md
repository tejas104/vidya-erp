# Vidya ERP — MASTER PLAN (market-standard build-out)

> Owner mandate: implement the full 8-dashboard taxonomy fast, with parallel
> agents, to market standards. This is the program-level plan: every module,
> its data model, routes, screens, file inventory, and gates. Each lane
> generates its detailed per-module implementation plan (house pattern:
> complete code, TDD) at execution start — module details below are the
> binding contract those plans implement.

## 0. Execution model

**Lanes.** Work runs in parallel lanes; each lane = one agent in its own git
worktree (`Agent isolation: worktree`) on its own branch, merged by the
controller in the stated train order. The controller (main session) runs
Lane A inline and reviews/merges everything.

**Shared-file law** (the only real conflict surface):
`apps/web/src/ui/api.ts`, `navConfig.ts`, `Icon.tsx`, `apps/web/src/composition.ts`,
`apps/worker/src/main.ts`, `scripts/registry.ts`, root+web+worker `package.json`,
`scripts/seed-demo.ts`, `.superpowers` ledger. Rule: **append-only additions in
clearly-owned blocks** (each module adds its own contiguous block with a
`// --- <module> ---` marker); controller resolves merges; never reformat
neighbours.

**Per-module Definition of Done (market standard):**
1. Migration up+down; `migrate.ts status` clean.
2. Routes scoped (ScopeChecker or self-link) + audited writes + zod schemas;
   409/422/403/404 paths verified; OpenAPI regenerated.
3. Module unit tests (happy + denial + conflict) green; suite-wide
   typecheck/lint/unit/ui green.
4. Screens in the app shell, both themes, kit components only, empty/withheld/
   error states designed; RTL per screen.
5. Seeder extended so demos show real data; live Playwright drive per affected
   role with screenshots reviewed; zero console errors.
6. Ledger updated; branch merged to main only when all green.

**House invariants** (bind every lane): no new runtime deps without ADR;
module boundaries (public `index.ts` only); org-path columns on rows for
scope checks; `collegeId` on every table (tenant key); pgErrorCode unwraps
`.cause`; identity links (not grants) for self-scope; problem+json errors.

## 1. Module inventory (the whole taxonomy)

### M1 — Timetable *(Lane A, IN FLIGHT — backend committed b156c77)*
Tables: `ttb_periods(college,no,starts,ends UQ)`, `ttb_entries(org-path cols,
subject,teacher,room,day 1-6,period,year; UQ section/teacher/room×slot)`.
Routes: periods-get/set, entry-create (422 subject-dept, 409 named clash),
entry-delete, section-grid (scope read), my-today (teacher self-link).
Remaining: registry+roots wiring, web route files, portal `my-timetable`/
`my-today` (via `TimetableReadModel`), UI (`/manage/timetable` grid editor;
Faculty **Today** card on dashboard → attendance prefill via query params;
portal Today strip + weekly grid), seeder P1–P6 + demo week, tests, drive.

### M2 — Coursework: assignments + notes/study material *(Lane B)*
Tables: `cwk_assignments(id, org-path, class,section?,subject, teacher_id,
title, instructions, due_on, max_score?, year)`, `cwk_submissions(id,
assignment_id, student_id, text?, object_key?, submitted_at, score?,
feedback?, evaluated_by/at)`, `cwk_materials(id, org-path, class, subject,
teacher_id, title, object_key, content_type, size, year)`.
Storage: MinIO via existing `createObjectStorage` (bucket path
`coursework/<college>/…`); uploads as base64/body-stream through the API
(1MB cap like imports) — no presigned URLs in v1.
Routes: assignment create/list-by-class/get/delete (teacher-of-subject via
assignments check like marks), submission submit (student self-link; one per
student, resubmit allowed until evaluated), submissions-list + evaluate
(teacher), material upload/list/download (download re-scope-checked;
students of the class allowed via enrollment check). Audited writes.
Screens: Faculty `/manage/coursework` (create assignment, list, evaluate
grid, upload notes); Student portal **Assignments** (list due/submitted,
submit text/file) + **Study material** (download list). Dashboard hooks:
faculty Today card shows "assignments due to evaluate: N"; portal shows
"due soon" strip. Reports: submissions-per-assignment counts.

### M3 — Notices, events, calendar *(Lane B, after M2)*
Tables: `ntc_notices(id, college, audience enum all|staff|students|
department:<id>, title, body, publish_at, expires_at, created_by)`,
`ntc_events(id, college, title, on_date, kind exam|holiday|event, details)`.
Routes: notice create/list(visible-to-me)/delete (admin/principal create;
audience filter server-side), events CRUD (admin), calendar-month read.
Screens: `/manage/notices` (compose + list), Notices card on every dashboard
(role-filtered), portal Notices + Calendar (month grid of events, kit-built).

### M4 — Fees + payments + Accountant dashboard *(Lane C)*
Tables: `fee_heads(id, college, name)`, `fee_structures(id, college, class_id,
year, head_id, amount, due_on, installment_no)`, `fee_invoices(id, college,
student_id, structure refs snapshotted, amount, due_on, status
pending|part|paid|waived, year)`, `fee_payments(id, invoice_id, amount, mode
cash|upi|card|bank|gateway, ref, received_by, received_at)`,
`fee_adjustments(id, invoice_id, kind scholarship|fine|refund|waiver, amount,
reason, actor)`. Derived: dues = invoice − payments ± adjustments.
Routes: heads CRUD, structure set-per-class (generates invoices for enrolled
students — job in worker for bulk), invoice list per student/section
(scope-checked), record-payment (accountant/admin; receipt no. = audited
sequence), adjustment add, my-fees (student self-link: status + history),
collection-summary (day/range; college/department), defaulters list.
Role: **new `accountant` role** (ROLES + migration + grant shape college-wide
+ checker case: read fees + write fee records only — mirrors admin pattern
scoped to module "fees").
Screens: `/manage/fees` (heads, class structures, generate invoices),
`/manage/collections` (Accountant dashboard: today's cash book, record
payment by admission-no lookup, receipts, dues/defaulters table, adjustments);
Principal dashboard gains Fee Collection widget (summary endpoint); portal
**Fee Status** (invoices, pay-history; gateway = "record only" v1 — online
gateway lands with M12 config). Reports: collection, outstanding (reuse
reporting module: new report kinds `fee-collection`, `fee-dues`).

### M5 — Results/GPA + certificates *(Lane A, after M1)*
Tables: `res_grade_scales(id, college, name, bands jsonb [{min,grade,points}])`,
`res_subject_credits(id, class_id, subject_id, credits, year)`,
`res_publications(id, college, class_id, year, term, published_at, by)` —
results visible to students only after publication.
Compute: SGPA/CGPA from marks (academics read model) × credits × scale;
grade-card = new report kind `grade-card` (reporting module PDF, per
student). Rank within class (published set only).
Routes: scale CRUD (admin), credits set (admin/hod), publish (principal/
admin, audited), my-results (student self, published only), class-results
(staff scope), gpa in analytics student-performance surface.
Screens: `/manage/results` (scale editor, credits grid, publish button with
ConfirmDialog), portal **Results** tab (published terms, SGPA/CGPA, download
grade card), Principal pass/fail analytics card.

### M6 — Exams scheduling + quiz (basic) *(Lane A, after M5)*
Tables: `exm_series(id, college, name, year, term)`, `exm_slots(id, series,
class_id, subject_id, on_date, period_no or time, room)`. Quiz v1 =
assessment kind already exists; portal shows **Exam schedule** (from slots,
self section); faculty/HOD see class schedules; clash checks vs timetable
optional (warn only). Screens: `/manage/exams` (series + slot grid), portal
Exam Schedule card, notices auto-draft on publish (M3 hook).

### M7 — Leave + messages *(Lane D)*
Tables: `lvs_requests(id, college, teacher_id, from,to,kind,reason, status
pending|approved|rejected, decided_by/at)`, `msg_threads(id, college,
participants jsonb [userIds], subject)`, `msg_posts(id, thread, author,
body, at)`. Routes: leave apply (teacher self-link), approve/reject
(hod-of-dept/principal, audited), my-leaves; thread create/list-mine/post
(participants only — self filter). Screens: faculty **Leave** page + HOD
approvals inbox (dashboard card), simple **Messages** page (threads list +
posts) for staff; portal complaint = thread to admin (labels it
"Complaint") satisfying the Complaint Portal item.

### M8 — Library *(Lane D, after M7)*
Tables: `lib_books(id, college, isbn, title, author, copies_total,
copies_out, barcode)`, `lib_loans(id, book, member kind+id
(student|teacher), issued_at, due_on, returned_at, fine_paise)`,
`lib_reservations(id, book, member, at, status)`. Fine rule: config
paise/day. Routes: catalog CRUD+search (librarian=admin v1; dedicated
`librarian` role optional flag-off), issue (barcode/id), return (computes
fine), reserve, my-loans (self-link both kinds), overdue list. Screens:
`/manage/library` (catalog table+search, issue/return workbench, overdue),
portal **Library** (my loans/fines/reservations). Reports: usage, overdue.

### M9 — Hostel + transport (thin v1) *(Lane D, after M8)*
Tables: `hst_rooms(id, college, block, room_no, capacity)`, `hst_allocations
(id, room, student_id, from,to)`; `trn_routes(id, college, name, stops
jsonb)`, `trn_allocations(id, route, student_id, stop)`. Routes: CRUD +
allocate + my-allocation (self). Screens: `/manage/hostel`,
`/manage/transport` (tables + allocate modals), portal cards. Reports:
occupancy, route allocation counts.

### M10 — Placement *(Lane C, after M4)*
Tables: `plc_companies(id, college, name, tier, contact)`, `plc_drives(id,
company, kind job|internship, role, package, on_date, eligibility jsonb
{minCgpa?, departments[]})`, `plc_applications(id, drive, student_id, status
applied|shortlisted|interview|offered|rejected, resume_key?)`, offers derived
from status. Routes: companies/drives CRUD (admin/placement-officer=admin
v1), eligible-students (eligibility × GPA from M5 read model), apply
(student self, eligibility enforced), status update, stats (offers, avg
package, dept-wise). Screens: `/manage/placement` (companies, drives,
applicants pipeline board), portal **Placement** (open drives, my
applications, offer status). Reports: placement statistics.

### M11 — Licensing & entitlements *(Lane E — the W2 spec, unchanged)*
`lic_licenses` signed ed25519 blobs; platform `RouteSpec.feature` +
`defineRoute` gate; plans core/plus/enterprise mapping (reporting,
analytics-advanced, portal, coursework, fees, library, placement =
plan-gated features); `/manage/license` screen; `scripts/license-tool.ts`
keygen/mint; seat limits displayed (enforced M12).

### M12 — SaaS/ops hardening *(Lane E, after M11)*
Cross-tenant regression suite (integration: college-B caller × college-A
resources ⇒ 403/404 for EVERY route table-driven); seat enforcement on
create paths (license gate consulted in people/identity handlers);
`sys_settings` table + `/manage/settings` (email/SMS/gateway config stored
encrypted, provider stubs with console transport in dev); backup/restore
runbook + `scripts/backup.ts` (pg_dump + MinIO mirror); audit-log viewer
`/manage/audit` (filter by actor/action/resource, admin, read-only);
prod posture checklist enforced by `loadConfig` when NODE_ENV=production
(secure cookies, no default secrets).

### M13 — Reports catalog + Super-Admin completion *(Lane E, last)*
New report kinds wired into the existing reporting engine as modules land:
faculty attendance (from M7 leave + timetable presence), fee collection/
outstanding (M4), pass/fail (M5), placement stats (M10), library usage (M8),
hostel occupancy/transport (M9). `/manage/reports` gains a "Request" panel
(pick kind + scope + format). Super-Admin dashboard = admin home page
assembling: institution KPIs, module health, license status, backup status,
audit tail, quick links — pure composition of existing endpoints.

### M14 — Parents + online classes (thin) *(backlog, after M1–M13)*
Parent = second identity link on student (`guardian_user_id`) with the same
portal in read-only; online classes = meeting-URL field on timetable entries
+ "Join" button (no conferencing build).

## 2. Dashboard → module map (acceptance view)
- **Student**: profile/attendance/subjects/results-partial ✅ + M1 timetable,
  M2 assignments/notes, M3 notices/calendar, M5 results/GPA/certificates,
  M4 fee status, M6 exam schedule, M8 library, M9 hostel/transport,
  M10 placement, M7 complaints.
- **Faculty**: attendance/marks ✅ + M1 Today/timetable, M2 create/evaluate/
  notes, M6 exam marks flow (exists via assessments), M7 leave/messages,
  M3 calendar. Lesson planning = M2 materials with `kind=plan` tag.
- **HOD**: analytics ✅ + M1 dept timetables (approval=backlog), M7 leave
  approvals, M5 internal-mark publish approvals, faculty workload (M1
  entries-per-teacher count).
- **Principal**: overview/comparison ✅ + M4 fee collection, M3 notices,
  M7 complaints/approvals, M5 pass-fail, admissions stats (people counts).
- **Accountant**: M4 entirely. **Library**: M8. **Placement**: M10.
- **Super Admin**: manage areas ✅ + M11 license, M12 settings/backup/audit,
  M13 assembled home.

## 3. Lanes & merge train
- **Lane A (controller, inline):** M1 finish → M5 → M6.
- **Lane B (worktree agent):** M2 → M3.
- **Lane C (worktree agent):** M4 → M10.
- **Lane D (worktree agent, starts after first merges):** M7 → M8 → M9.
- **Lane E (worktree agent, after B/C merge):** M11 → M12 → M13.
Merge train: M1 → M2 → M4 → M3 → M5 → M7 → M6 → M8 → M10 → M9 → M11 → M12 → M13.
Controller merges each lane branch after DoD review (diff package + gates);
conflicts limited to shared-file blocks by law above.

## 4. Risks
Parallel shared-file drift (mitigated by block-append law + controller
merge); role additions (accountant) ripple the checker/fakes exactly like
`student` did — same recipe; object storage size limits v1 (1MB) noted in
UI; GPA correctness needs golden-number unit tests; session budget — every
lane commits compiling checkpoints so any session can resume from ledger.
