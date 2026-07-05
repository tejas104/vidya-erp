# ADR-0017: The attendance-vs-marks scope model

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

The permission matrix (ADR-0010, human-owned) keys its teacher rules on
one bit: does the record carry a `subjectId`? Subject records (marks) are
private to their subject's teacher; non-subject records (attendance,
conduct…) are class-visible and class_teacher-writable. #4 is where that
distinction meets real data, and a blurred line here leaks real students'
marks.

## Decisions

1. **The distinction is enforced by construction, in one file.**
   `src/resource-refs.ts` holds the only two ResourceRef builders:
   `attendanceRef` (input type HAS no subject field — one cannot be passed
   by mistake) and `marksRef` (subjectId is mandatory, and handlers take
   it from the stored assessment row, never from caller input). Every
   handler decision uses these builders; the file carries a 100% coverage
   gate and the worked traces (`src/scope-traces.test.ts`) execute against
   the REAL human-owned checker.
2. **Attendance writers are class_teachers.** Direct consequence of the
   frozen matrix (teacher writes = own-subject records only; attendance is
   non-subject) and of the assignment's own trace list. Subject-teacher-
   marked attendance would be a matrix change → surfaced per ADR-0016,
   not worked around; not requested, not built.
3. **Assessment types are a fixed enum** (`exam|quiz|assignment`) on
   assessments, not CRUD rows: the assignment names exactly this
   taxonomy, and a college-level academic taxonomy record would be
   writable by NO role under the matrix (admin writes exclude academics —
   correctly). Extending the list is a migration, reviewed like any DDL.
4. **Denormalized org paths, stamped at write time.** Sessions store the
   full section path; assessments store the class path; entries/marks
   inherit from their parent. Paths are resolved and validated against the
   PeopleDirectory (#3) once at creation. Safe because the org tree has no
   move operation (ADR-0014); correct because academic records are records
   OF events — a transferred student's old attendance stays with the
   section where it happened.
5. **Marks anchor at class level** (assessment = class + subject; sections
   don't partition marks). Containment consequence, documented: a manually
   issued section-scoped teacher grant does not reach class-level marks;
   #3's derived grants are class-level, so the working path is unaffected.
6. **Grade-change integrity = current row + append-only trail.** Marks are
   single current rows; every bulk entry and correction audits with
   per-entry before/after, actor, assessment and student (bulk diffs
   capped at 100 per event). `GET /marks/{id}/history` reassembles the
   trail from the audit seam (system module's `readAuditEventsForResource`)
   and is scope-checked exactly like reading the mark. `score <= maxScore`
   is service-enforced (cross-table); `score >= 0` and the taxonomy are
   DB CHECKs.
7. **All-or-nothing bulk writes, request-sized.** A section's attendance
   and an assessment's marksheet are ≤ hundreds of rows: they run
   synchronously with batch validation (roster membership, score ranges,
   in-request duplicates) and reject as a whole with per-entry reasons
   (422) — the teacher's paper sheet and the system never half-agree. One
   scope decision legitimately covers each batch: every row shares the
   session's/assessment's single ResourceRef.
8. **The worker job is the daily attendance-gap scan** — the genuinely
   college-wide operation (sections with live enrollment but no session
   today), audited when gaps exist, feeding a Prometheus counter. Nothing
   else in this module is heavy enough to justify async dressing.

## Consequences

- Future record kinds must choose a side deliberately: subject-bound →
  marksRef-shaped builder; class-visible → attendanceRef-shaped. Adding a
  third builder to resource-refs.ts inherits the 100% gate and belongs in
  this ADR's revision history.
- Report cards/analytics (later tiers) will consume these tables through a
  read-model service on the academics public API — none exists yet by
  design.
