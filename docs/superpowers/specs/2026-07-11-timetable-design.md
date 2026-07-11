# Design — Timetable + daily dashboards (ERP program, sub-project 1)

- **Date:** 2026-07-11
- **Status:** Approved in brainstorming (owner picked timetable-first; fixed
  period grid). Part of the full-ERP taxonomy round; see
  `2026-07-11-saas-program.md` (this becomes the first W4-class module,
  pulled ahead of licensing by owner decision).

## Goal

The spine of both daily workflows: a fixed-period timetable module, a Faculty
**Today's Schedule → open period → mark attendance** flow, the student's
timetable in the portal, and an admin weekly-grid editor. Simple, clean UI.

## Decisions

1. **Fixed period grid**: the college defines P1..Pn with start/end times once
   (`ttb_periods`); entries address `(day 1–6, periodNo)`.
2. **Clash detection is the database**: unique constraints per
   (section|teacher|room) × (day, period, year), surfaced as friendly 409s
   naming the busy resource (the pgErrorCode unwrap makes this reliable).
3. **Room is a label** in v1 (no rooms entity); empty room = no room clash.
4. **Teacher self-scope mirrors the student portal**: `ttb` resolves "my
   schedule" through a new `PeopleDirectory.teacherByIdentityUser` — no
   teacherId spoofing possible on the self routes.
5. **Teacher picker = teachers assigned to the class** (from
   `class-assignments`) — the timetable can only schedule teachers who
   actually teach there.
6. Deferred: HOD approval workflow, rooms CRUD, multi-period labs.

## Module `@vidya/module-timetable` (`ttb_`)

Tables: `ttb_periods (college_id, period_no, starts, ends, UNIQUE(college,no))`;
`ttb_entries (id, college_id, department_id, class_id, section_id, subject_id,
teacher_id, room, day_of_week 1–6 CHECK, period_no, academic_year)` with the
three clash constraints + org-path columns stored for scope checks (the
academics pattern).

Routes (scoped/audited like every module):
- `timetable.periods-get` GET `/api/v1/timetable/colleges/{collegeId}/periods` (any auth)
- `timetable.periods-set` PUT same (admin, audited) — replace-all template
- `timetable.entry-create` POST `/api/v1/timetable/entries` (admin, audited):
  body `{sectionId, subjectId, teacherId, room?, dayOfWeek, periodNo,
  academicYear}`; resolves the section's org path via the directory; 422 when
  the subject isn't of the section's department; 409 clash → names the busy
  resource (section/teacher/room)
- `timetable.entry-delete` DELETE `/entries/{entryId}` (admin, audited)
- `timetable.section-grid` GET `/sections/{sectionId}/grid?academicYear`
  (any auth; scope-read at the section path; names enriched)
- `timetable.my-today` GET `/my/today?academicYear` (teacher roles; resolved
  via the teacher identity link; returns ordered periods with section/subject
  names + sectionId for the attendance hand-off)

Service exports `TimetableReadModel { periods(collegeId), sectionGrid(sectionId,
year), sectionDay(sectionId, year, day) }` consumed by the **portal module**,
which gains `portal.my-timetable` + `portal.my-today` (student self-scope).

## UI (frontend-design-guided, both themes)

- **`/manage/timetable`** (admin, nav under Administration): period-template
  editor (rows of no/start/end + Save) and a per-section **weekly grid** —
  days × periods matrix; empty cell `+` opens a modal (subject from the
  department, teacher from the class's assignments, room text); filled cell
  shows subject · teacher · room with delete. 409s toast as "…is already
  booked then".
- **Faculty dashboard "Today" card** (teacher/class_teacher): today's ordered
  periods (time, section, subject, room) each with **Open → mark attendance**
  linking `/manage/attendance?sectionId=…&date=today` (attendance page reads
  the query params to preselect).
- **Student portal**: a "Today" strip + the weekly grid, self-scoped.
- **Seed/demo**: default P1–P6 template + a filled week for both demo classes
  so every dashboard shows real data (also created live for the current DB).

## Testing & verification

Unit: repo clash constraint mapping (409 naming the resource), self-scope link
resolution, subject-department 422. UI: grid editor renders + posts the right
entry body; Today card renders; portal timetable renders. Live: migrate,
restart, build a demo timetable via UI/API, drive teacher (Today → open →
attendance preselected) and student (portal timetable) with screenshots; clash
attempt shows the friendly 409. Full typecheck/unit/ui gates; merge to main
when green (owner's standing cadence).
