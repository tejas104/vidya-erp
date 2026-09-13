# ADR-0023: The school edition's org tree — one implicit department

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

ADR-0014 fixed the org tree as college → department → class → section, and
`OrgPath` (`packages/platform/src/auth/types.ts:24-29`) encodes exactly those
four named levels. `docs/architecture/editions.md` then found that "edition"
decided nothing: the only code branching on it returned identical CSV columns
for both editions (`packages/modules/people/src/api/handlers.ts:137-143`).

On 2026-09-12 the owner answered that file's open question 1: the school
edition's tree is **school → standard → section**. A school has no department
level. Assignments #14 and #15 build school-only modules on top of it, so
every table, scope grant and containment probe there derives from this shape.

Three representations were considered.

## Decision

**A school install keeps the physical four-level tree and gets exactly ONE
implicit department, which its UI and API never render or accept.** Standards
are `ppl_classes` rows under it; sections are `ppl_sections`. A school
resource therefore still carries a full four-level `OrgPath` whose department
level is that row.

- `IMPLICIT_DEPARTMENT_CODE = "__SCHOOL__"` and
  `OrgService.ensureImplicitDepartment(collegeId)`
  (`packages/modules/people/src/service/org-service.ts`) — idempotent,
  resolves by the reserved code, audits `people.implicit-department-created`
  as system activity.
- `people.department-create` returns **409** on the school edition
  (`packages/modules/people/src/api/handlers.ts`). The "exactly one" invariant
  is enforced at the trust boundary, not left to a hidden form.
- `scripts/create-admin.ts` seeds it when `config.edition === "school"`.

## Why not the alternatives

**Nullable `department_id`** (a physically three-level tree) was rejected.
Both `ppl_classes.department_id` and `ppl_subjects.department_id` are NOT NULL
(`packages/modules/people/src/db/schema.ts:41`, `:58`), and
`OrgDirectory.verifyOrgPath` refuses a `classId` without a `departmentId`
(`packages/modules/people/src/service/org-service.ts:40-42`). Making the level
nullable means a migration on two tables **shared with the college edition**,
plus every join, grant-derivation path (ADR-0015) and containment check
handling the hole — for a level the school product does not have. The
college regression net is what #14/#15 use to prove zero behavioural change;
this option puts it directly at risk.

**Separate `sch_*` org tables** were rejected as duplicating enrollment,
teacher assignment and grant derivation forever, leaving two org trees to keep
in sync.

## Consequences

- **No change to `identity/src/core/`.** `ScopeChecker.covers()`
  (`scope-checker.ts:24-31`) already treats a level the grant does not specify
  as "matches anything", so a school path resolves through the existing
  checker unmodified and every existing containment probe stays valid. This
  matters because that directory is human-owned (ADR-0012, ADR-0016) and
  #14's verification requires a zero diff there.
- The `hod` role is department-scoped and therefore unused on a school
  install. It is not removed — it simply has nothing to scope to.
- One synthetic row exists that only SQL ever sees. A sentinel code was
  chosen over an `is_implicit` column to avoid a migration; add the column if
  a school ever legitimately needs a second department.
- `codeSchema` (`packages/modules/people/src/definition.ts:12`) permits any
  1–32 character string, so `"__SCHOOL__"` is technically enterable on a
  college install. Harmless there (it is just a department code), and
  unreachable on a school install because department creation 409s.
