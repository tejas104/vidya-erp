# ADR-0013: Matrix extension — admin writes for people-module records

- **Status:** **Ratified 2026-07-05** (ADR-0016). Authorized by the
  platform owner in the #3 approval ("take the best decision … instead of
  doing any human changes"); modifies the HUMAN-OWNED scope-checker
  (ADR-0012) so it was flagged for ratification in docs/review-gate-3.md.
  Ratification verified the diff against this ADR and ran the conformance
  suite (green). The standing change-control rule for such edits is ADR-0016.
- **Date:** 2026-07-04 (ratified 2026-07-05)

## Context

Vidya #3 introduces the org tree and people records (`module: "people"`),
and requires every read AND write to flow through the ScopeChecker. The
matrix as frozen after #2 allowed admin writes only for
`resource.module === "identity"` — under it, **no role could create a
college, department, class, section, subject, student, teacher, enrollment
or assignment at all**. Reads needed no change: rosters and org units
carry no `subjectId`, so the existing containment rules already give
teachers/class_teachers/hods/principals exactly the read surface the
approved matrix intends.

## Decision

One-line change to the admin case of the human-owned checker
(`src/core/scope-checker.ts`): admin `create/update/delete` are permitted
when `resource.module === "identity" || resource.module === "people"` —
i.e. **administrative** records. Everything else is untouched:

- still strictly college-scoped by the admin grant's OrgPath;
- academic records (the future academics module) remain admin-read-only;
- `approve` remains hod-only, everywhere;
- teacher/class_teacher/hod/principal gain no write authority over people
  records.

Fourteen new conformance cases pin the extension and its non-goals in
`src/core/conformance/scope-checker.ts` — eleven for the admin/role write
boundaries introduced here, plus three that pin the checker's pre-existing
"promotion" clause (class_teacher writes non-subject records of their own
class; college-anchored records stay unreachable via containment).

## Alternatives rejected

- **Route-level role gate only for people writes** — violates the #3
  requirement that no data access bypasses the chokepoint, and would make
  the people module the one place where the matrix lies.
- **A `registrar` role** — new role machinery for no present need; admins
  are the operators who manage structure in this deployment phase. Revisit
  when the institution wants separation of duties (future ADR).

## Consequences

- The security team must ratify this diff (one function + conformance
  cases) — it is deliberately the smallest reviewable surface.
  **Done 2026-07-05 (ADR-0016); size did not shorten the process.**
- Future modules must NOT piggyback on `module: "people"` naming to gain
  admin writability; adding any module to the administrative set is a new
  ADR + conformance change.
