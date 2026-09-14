# ADR-0024: Module-owned role rules where the shared matrix grants no authority

- **Status:** Accepted
- **Date:** 2026-09-14

## Context

`ScopeChecker` (`packages/modules/identity/src/core/scope-checker.ts`) is the
single authority for access decisions and is **human-owned** — ADR-0012 and
ADR-0016 forbid agent edits to that directory, and assignments #14/#15 require a
zero diff there.

Its `grantAllows` matrix allowlists the admin role's write verbs by module:

```ts
case "create": case "update": case "delete":
  return resource.module === "identity" || resource.module === "people";
```

(`scope-checker.ts:100-105`; `people` was itself an owner-authorized extension,
ADR-0013.) `principal` is read/export only, `hod` adds `approve`, `teacher` and
`class_teacher` are gated on `subjectId`, `student` fails closed.

The consequence is easy to miss and was discovered while building the school
term module (#14): **a new module gets no write authority from the matrix at
all.** A literal `scopeChecker.check(principal, "create", ref)` on a resource in
a new module denies every role, forever, for every caller. The only fix *inside*
the matrix is an edit to the human-owned core.

This had already been hit twice and solved the same way both times, but the
decision lived only in code comments:

- `fees`: `writeAllowed` (`packages/modules/fees/src/handlers.ts:99-109`)
- `leave`: `decideAllowed`

## Decision

A module whose resources the matrix does not cover **owns its role rule, but
never its containment rule**. The shape is:

```ts
function writeAllowed(principal: Principal, org: OrgPath): boolean {
  if (!readAllowed(principal, org)) return false;   // shared checker decides tenancy
  return principal.roles.includes("admin");          // module decides the role
}
```

Two properties make this safe and are **mandatory**:

1. **Containment is always decided by the shared `ScopeChecker`**, via a `read`
   decision on the module's own resource, and it runs **first**. Nothing about
   org containment is hand-rolled. A caller outside the college is rejected
   before the role rule is consulted, so tenancy stays fail-closed.
2. **The module-owned part is only ever a role predicate** — never a path
   comparison, never a prefix match, never an "is this record mine" test. The
   moment a module needs to compare two `OrgPath`s itself, this ADR does not
   cover it: see ADR-0022 for the one sanctioned exception (audience matching)
   and stop.

The existing handler ordering still applies: load the stored record first, 404
before 403, then the scope decision, then mutate (the `marksEnter` template,
`packages/modules/academics/src/api/handlers.ts:471-512`).

## Alternatives rejected

**Extend the matrix per module** (the ADR-0013 route). Correct in principle and
makes each resource first-class, but every new module would then require an
owner-authorized edit to the security core. That trades a small, reviewable,
module-local role check for a steady stream of changes to the one file the
project most wants to keep still. Rejected for now; it remains the right move if
school resources ever need role rules more expressive than "admin".

**Give the new module a bespoke containment check.** Rejected outright — this is
exactly what #11.5 spent an assignment removing, and ADR-0022 documents why the
two relations are not interchangeable.

## Consequences

- The scope surface is no longer entirely in one file. Mitigation: the role
  predicate is one named function per module, adjacent to its handlers, and this
  ADR is the index of where they live (`fees`, `leave`, `school-academics`).
- A security review must read those predicates in addition to the matrix.
- Mutation-proof required: removing the `readAllowed` guard must turn tests red.
  Verified for `school-academics` — dropping it turns 15 passed into 13 passed /
  2 failed.
- The same proof covers the added assessment routes. Bypassing their four shared
  checks made the named foreign-class and foreign-subject cases fail; restoring
  the checks returned 29/29 term/configuration unit tests and 6/6 authenticated
  school-marks integration tests to green (2026-09-14).

## Related: migrations are NOT edition-gated

Recorded here because it is the same "what does a school-only module mean"
question. `ModuleDefinition.editions` gates **module registration at runtime**
(routes, jobs, service) in both composition roots. It does **not** gate
migrations: `migrationSources()` (`scripts/registry.ts:51-56`) maps every module
definition, and `scripts/migrate.ts` never reads the edition.

So a college install creates the school module's tables and leaves them empty.
This is deliberate:

- one schema per release, identical migration journal across editions, which
  makes support and debugging the same job on both;
- changing an install's edition later needs no migration backfill.

The cost is an empty unused table on the other edition. If that ever becomes
more than cosmetic — a large table, or one carrying a destructive constraint —
gate `migrationSources()` by edition and accept the backfill problem.
