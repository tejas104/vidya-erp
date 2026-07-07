# Vidya ERP — product roadmap (full college-ERP vision)

- **Date:** 2026-07-07
- **Status:** Living roadmap. Each 🔨 item becomes its own design → plan → build.
- **Owner ask:** grow Vidya into a full college ERP (9 feature areas below).

## Build strategy: layers, not all-at-once

Roughly half the requested features have **no backend yet** (new tables,
modules, endpoints), so this is a program of work. We build in layers:

1. **Layer 1 — make the existing backend operable via UI** (Round 2, in
   progress): the `/manage` management screens over what already exists.
   See `2026-07-07-manage-ui-design.md`. **No new backend.**
2. **Layer 2+ — add each new module** one at a time, each its own
   design→plan→build cycle (schema → endpoints → UI → tests).

## Feature areas — status against the current backend

Current modules: identity, people, academics, analytics, reporting.

| # | Area | Already in backend | Net-new backend needed |
|---|------|--------------------|------------------------|
| 1 | **Student Information System** | personal details, roll no (`admissionNo`), branch (`department`), enrollment, editable records, attendance, marks | fees, certificates, documents, admission *history*, semester-as-entity |
| 2 | **Faculty Management** | profile (`staffNo`), subjects taught (assignments), department | qualification, timetable, leave, salary, faculty attendance |
| 3 | **Course Management** | departments, classes, sections (divisions), subjects | courses-as-entity, credits, semester-as-entity, electives |
| 4 | **Attendance** | manual record/correct; reports (analytics: subject-/student-wise, defaulters≈at-risk) | QR-code capture, daily/monthly report views |
| 5 | **Timetable** | — | entire module: rooms, periods, weekly schedules, clash detection |
| 6 | **Examination** | assessments model exam *types* (quiz/unit/exam…) + marks | structured exam management (internal/unit/mid/final/practical/viva), exam scheduling |
| 7 | **Results** | marks, per-student performance, analytics | credits + grading scale → GPA/CGPA, grade cards (doc gen), rank |
| 8 | **Fees management** | — | entire module: fee heads, structures, invoices, payments, receipts, dues |
| 9 | **Assignment management** | teacher→class/subject assignments exist | ❓ if **student homework** (submit + grade): entire new module |

> **#9 needs a decision:** "assignment management" = teacher assignments (exist,
> covered by Layer 1) OR student homework/submissions (new module). Assumed
> homework for roadmap purposes; confirm when we reach it.

## Suggested module order (Layer 2+)

Independent, high-value, self-contained modules first:

1. **Results / GPA-CGPA + grade cards** — extends existing marks; needs credits +
   grade scale. High academic value, natural next step after marks entry.
2. **Fees management** — fully self-contained; clear value.
3. **Timetable** — self-contained; visual; feeds faculty/course views.
4. **Student assignments (homework)** — if that's #9.
5. **QR-code attendance** — extends existing attendance.
6. **Documents & certificates** — storage + generation.
7. **Faculty extras** (qualification/leave/salary/faculty attendance) and
   **model gaps** (credits/electives/semester-as-entity) — folded into the
   modules that need them.

Order is a recommendation; the owner picks the next module at each layer.

## Constraints that carry across every module

- On-premise; dependency-justified (ADR-0009); modular-monolith boundaries are
  build-enforced.
- Every record access goes through the ScopeChecker + audit (ADR-0018 etc.).
  New modules must follow the same read-model / disclosure discipline.
- New-college creation stays CLI-only (ratified parked decision).
