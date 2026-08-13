# ADR-0022: Containment and audience-matching are distinct relations

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Assignment #11.5 Part 2 moved `leave`, `exams`, `results` and `notices` off
hand-rolled containment onto the shared `ScopeChecker`
(`packages/modules/identity/src/core/scope-checker.ts`), deleting the
per-module `covers()`/`inCollege()` helpers. One helper was **deliberately
kept**: `orgOverlaps()` in `packages/modules/notices/src/handlers.ts:36-41`,
used only by the `notices.visible` handler
(`packages/modules/notices/src/handlers.ts:133-171`, call site at line 165).

This was found *during* the migration, not planned going in: `notices` was
the one module where swapping in `scopeChecker` broke a passing test. The
gap is reported here rather than worked around.

The shared checker's `covers()` (`scope-checker.ts:24-31`) encodes one
direction only: *"a grant covers a resource when every level the grant
specifies matches the resource exactly … a grant that is MORE specific than
the resource … does not cover it — authority never widens upward."* That is
the correct rule for **access**: can this principal act on this record. A
class-scoped grant must not confer department- or college-wide authority.

`notices.visible` asks a different question: *does this notice's audience
include me?* A college-wide notice (audience `"college"`) must be visible to
a class-scoped teacher — the exact case `covers()` is built to deny. Both
questions compare two `OrgPath`s and look nearly identical in code; they are
not the same relation.

## Decision

Keep two operations, one per relation:

- **Access (containment, one-directional):** `notices.create`, `.list` and
  `.delete` — plain single-`collegeId` admin/principal containment — now use
  `deps.scopeChecker.check(...)` via `readAllowed()`
  (`handlers.ts:51-53`).
- **Audience-matching (overlap, bidirectional):** `notices.visible` keeps
  `orgOverlaps(a, b)` (`handlers.ts:36-41`), which returns true whenever
  neither path contradicts the other on a level both define — true in
  *either* direction, unlike `covers()`.

Picking the wrong relation fails in opposite, both-bad ways:

- Use `covers()` for audience matching → every department/college-wide
  notice becomes invisible to anyone holding a narrower grant. Silent: it
  reads as a data problem ("no notices for this class"), not a permissions
  bug — see `handlers.test.ts:97-101`, "class grant overlaps its class and
  its department, not a sibling class," which fails under `covers()`.
- Widen `covers()` (or the shared checker generally) to make audience work
  → authority leaks upward for every module that consumes
  `ScopeChecker`, not just notices. `covers()` is shared, human-owned
  (ADR-0012) infrastructure; there is no way to special-case one caller.

`packages/modules/notices/src/handlers.test.ts` proves both sides:
`describe("orgOverlaps (pure)", ...)` (lines 92-102) pins the relation
directly, and `describe("notices.visible — the audience matrix", ...)`
(lines 104-116) proves it end to end — a class-scoped teacher and a
class-scoped student both see the college-wide, department-wide and
own-class notices their grant is narrower than.

## Do not consolidate this

If you are reading `orgOverlaps()` and thinking "this looks like the
`covers()` case someone forgot to migrate" — it wasn't forgotten. It was
kept on purpose, and consolidating it onto `scopeChecker.check()` will pass
type-checking and silently break `notices.visible` for every non-college-
scoped staff member. Before touching it, read the docstring at
`handlers.ts:20-35` and this ADR.

This is not a permanent exception, only an unfilled interface gap: if
`ScopeChecker` ever grows an explicit audience-matching predicate (the
inverse of `covers()`), that predicate supersedes `orgOverlaps()` here and
this ADR should be closed out in favor of it. Until then, `orgOverlaps()` is
the audience-matching primitive and containment is `scopeChecker.check()` —
do not use one where the other belongs.

## Consequences

- Any future module that needs "is X in the audience of Y" (not "does X have
  access to Y") should reach for `orgOverlaps()`'s shape, not
  `ScopeChecker.check()` — and should consider whether that predicate
  belongs on the shared checker instead of being reinvented per module.
- `packages/modules/identity/src/core/` is untouched by this ADR; it
  documents a consumer-side distinction, not a change to the human-owned
  matrix.
