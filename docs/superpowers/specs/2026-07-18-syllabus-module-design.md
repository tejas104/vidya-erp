# Syllabus Module — design

**Date:** 2026-07-18
**Status:** approved (structured units/topics + coverage tracking; subject-teacher authored; student portal read; coverage = date)
**Modeled on:** `@vidya/module-coursework` (compact module: `definition.ts` / `handlers.ts` / `repo.ts` / `db/schema.ts` / `index.ts`; `directory` port; subject-scoped teacher writes; `my/*` student portal reads).

## Goal
A new `@vidya/module-syllabus`: each subject (as taught in a class in an academic
year) has a structured syllabus of **units → topics**, authored by the subject's
teacher, with per-topic **coverage tracking** (a "taught on" date). Staff read it
(row-filtered by subject scope); students see a read-only coverage view in the portal.

## Ownership & authoring
- **Subject teacher** authors and edits the units/topics for their subject, and marks
  topics taught. This matches the existing ScopeChecker `teacher` grant (write on
  own-subject records), so **no ScopeChecker/grant-matrix change** — identical to how
  coursework authorizes `assignment-create`.
- Anchoring is per **(collegeId, departmentId, classId, subjectId, teacherId,
  academicYear)** — the same anchor coursework uses. Two sections of one subject have
  independent syllabi (accepted trade-off of subject-teacher authoring).

## Data model (two tables, prefix `syl_`)
```
syl_units
  id            text pk
  college_id    text not null
  department_id text not null
  class_id      text not null
  subject_id    text not null
  teacher_id    text not null
  academic_year text not null
  title         text not null            -- "Unit 1: Kinematics"
  position      integer not null         -- ordering within the syllabus
  created_at    timestamptz not null default now()
  unique (class_id, subject_id, academic_year, title)

syl_topics
  id         text pk
  unit_id    text not null               -- FK-by-convention to syl_units.id
  title      text not null               -- "Newton's laws"
  position   integer not null            -- ordering within the unit
  taught_on  date null                   -- coverage: null = not taught yet
  taught_by  text null                   -- identity user id who marked it
  created_at timestamptz not null default now()
```
`taught_by`/`taught_on` are set together on mark-taught and cleared together on un-mark.
**Coverage %** is derived (never stored): `count(topics where taught_on not null) /
count(topics)`, computed per unit and per subject. Topic ordering + the `position`
column follow whatever integer-position idiom coursework/results already use; a topic's
`subject_id`/org for scope checks is resolved through its parent unit.

## Routes (mirror coursework; module id `syllabus`)
Auth constants reused from the coursework idiom: `TEACHER_ONLY`
(`rolesAnyOf: ["teacher","class_teacher"]`), `STUDENT_ONLY`, plus a staff read
requirement matching coursework's class-read (any authenticated staff, row-filtered by
scope).

**Subject-teacher writes** (all `TEACHER_ONLY`, scope-checked via
`teacherAllowed(principal, path, subjectId)` → existing teacher subject-write grant; 403
otherwise; audited):
- `POST   /api/v1/syllabus/units` — create a unit (body: classId, subjectId, academicYear, title, position).
- `PATCH  /api/v1/syllabus/units/{unitId}` — rename / reorder (title, position).
- `DELETE /api/v1/syllabus/units/{unitId}` — delete a unit (cascades its topics).
- `POST   /api/v1/syllabus/units/{unitId}/topics` — add a topic (title, position).
- `PATCH  /api/v1/syllabus/topics/{topicId}` — rename / reorder (title, position).
- `DELETE /api/v1/syllabus/topics/{topicId}` — delete a topic.
- `PUT    /api/v1/syllabus/topics/{topicId}/coverage` — mark taught / un-mark
  (body `{ taughtOn: string | null }`; sets `taught_by = principal.id` when non-null,
  clears both when null). Scope resolved via the topic's unit's subjectId.

**Staff read:**
- `GET /api/v1/syllabus/classes/{classId}/syllabus` — all units+topics+coverage for the
  class, **row-filtered by subject read scope** (a `teacher` sees only their own
  subject; class_teacher/hod/principal/admin see all). Mirrors
  `coursework.class-assignments`.

**Student portal read** (`STUDENT_ONLY`, via enrollment link, no org grant):
- `GET /api/v1/syllabus/my` — resolves the signed-in student's enrolled class and returns
  each subject's units/topics + coverage %. Mirrors `coursework.my-materials`.

`pnpm openapi:generate` after routes. Module registered in the platform composition the
same way coursework is (`index.ts` export + wherever modules are assembled).

## Web surface
- **`/manage/syllabus`** — new page, nav for `teacher · class_teacher · hod · principal ·
  admin`. Class picker → subject picker (subjects the caller may see). Teacher for their
  own subject: author units (add/rename/delete/reorder), topics under each unit, and a
  per-topic "Taught" toggle (a native `<input type="date">` defaulting to today; clearing
  un-marks) with a live **coverage ring** per unit + overall. Staff-read (other subjects)
  sees the same laid out read-only. Five states; both themes from tokens; `:focus-visible`;
  reduced-motion; honest empty ("No syllabus yet for this subject.") and 403/withheld.
- **Portal card "Course coverage"** — on `/portal`, a card listing the student's subjects
  each with a coverage bar (taught/total) and expandable units→topics (a taught topic
  shows its date; untaught shows a muted dot). Read-only. Follows the portal's existing
  per-card `catch(()=>null)` resilience idiom.
- **api.ts** client additions: `syllabusForClass(classId)`, `createUnit/updateUnit/deleteUnit`,
  `addTopic/updateTopic/deleteTopic`, `setTopicCoverage(topicId, taughtOn|null)`,
  `mySyllabus()`, plus `UnitView`/`TopicView`/`SyllabusView` types.

## Auth — no ScopeChecker change (confirm during build)
Writes carry `subjectId` + org and route through `teacherAllowed`, which the existing
`teacher` grant already permits for own-subject create/update/delete (scope-checker.ts
`teacher` case). Staff class-read is row-filtered by the existing subject read scope.
Student `my` read uses the enrollment link (portal pattern), consulting no org grant.
If implementation reveals a genuine need to touch `scope-checker.ts` or the conformance
matrix, STOP and flag the owner — do not author auth silently.

## Testing (real endpoints, live-verify)
- **Module unit tests (`handlers.test.ts`):** subject teacher creates units/topics and
  marks coverage; a teacher of a DIFFERENT subject is 403 on write and row-filtered out on
  read; coverage % computes correctly (0, partial, 100); un-mark clears `taught_on`+`taught_by`.
- **Integration (real DB):** full flow through the scope-checked routes with the demo seed —
  subject teacher authors + marks taught; a student of the class reads `my` and sees the
  coverage; a different subject's teacher is denied. `INTEGRATION_RESET_DB=true`.
- **UI test:** `/manage/syllabus` renders the five states; a mark-taught toggles coverage;
  the portal card renders coverage from a mocked `mySyllabus`.
- Commands: `npx vitest run --project unit --project ui`; integration per NEXT-SESSION.md;
  `pnpm openapi:generate`; `pnpm --filter @vidya/web build`.

## Seed
Seed a small syllabus for one or two seeded subjects (a couple of units, a few topics
each, some marked taught) so `/manage/syllabus` and the portal card aren't empty in the demo.

## Out of scope (deferred)
- HOD/admin curriculum authoring & a shared cross-section curriculum.
- Per-unit teaching-hours / learning-outcomes fields.
- Syllabus PDF upload.
- Coverage analytics rollups into the dashboards.
