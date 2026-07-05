# ADR-0014: The org model — tree, people records, enrollment

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

The people module owns the canonical org tree the whole platform hangs on:
the `OrgPath` type (#2) already fixed the shape — college → department →
class → section — and #2's grants reference these units as opaque strings.

## Decisions

- **Real tables, strict nesting:** `ppl_colleges → ppl_departments →
  ppl_classes → ppl_sections`, each child FK'd `ON DELETE RESTRICT` — an
  org unit with children or references cannot be deleted (409), ever;
  restructuring is explicit, audited work. Codes are unique per parent
  (case-sensitive, ≤32 chars); ids are prefixed opaque strings
  (`col_…`, `cls_…`) that nothing may parse meaning from.
- **Subjects belong to departments** (`ppl_subjects`) and meet classes only
  through teacher assignments; the grant model's `subjectId` refers here.
- **Students** (`ppl_students`) anchor at a college (unique admission no.
  per college) and acquire a tree position ONLY through enrollment: a
  student's ResourceRef org path is their live enrollment's section path,
  else `{collegeId}` — so unenrolled students are visible only to
  college-wide readers, by containment rather than by special-casing.
- **Enrollment** (`ppl_enrollments`): one live (`enrolled`) row per
  (student, academic year), enforced by a partial unique index; transfers
  withdraw-then-create and are audited with both sides; academic years are
  opaque labels ("2026-27").
- **Teachers** (`ppl_teachers`) anchor at a college; `identity_user_id` is
  an opaque cross-module link to the identity module (NO foreign key —
  Constitution rule 2), set by an audited admin action. A teacher record
  can exist before its login does (imports first, accounts later).
- **Assignments** (`ppl_teacher_assignments`): `subject_teacher` (class +
  subject) or `class_teacher` (class only), shape-CHECKed, one subject
  teacher per (class, subject, year). They are the SOURCE OF TRUTH for
  derived grants — ADR-0015.
- **College creation is bootstrap, not API:** an admin's authority is
  college-scoped, so no admin can create a college they don't yet govern.
  `scripts/create-admin.ts` creates (or reuses, by code) the college and
  its first admin together, audited as system activity.

## OrgDirectory

The people module implements #2's `OrgDirectory` contract with existence
AND nesting checks (a real department in the wrong college fails).
Composition injects it into identity late-bound (a provider function), so
the package graph stays acyclic: people → identity (derived-grant API),
identity → platform interface only.

## Consequences

- Deleting mistakes requires emptying the subtree first — safe by default.
- Student PII is deliberately minimal (name + admission no.); government
  identity and fee data belong to later, more heavily-guarded tiers.
- Multi-college deployments work by construction (every query and scope
  check is college-anchored), though single-college is the operative case.
