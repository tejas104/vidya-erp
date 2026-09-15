# Five distinct questions (proposed framing)

**Status: PROPOSED**, but this document is the load-bearing one: getting
these five questions confused is exactly how a guardian ends up with staff
scope "as a shortcut" (§5.2's explicit warning). Every conformance case in
`guardian-contract/cases.ts` exists to keep at least one pair of these
distinct.

## The five questions

| # | Question | Answered by | Where it lives today |
| --- | --- | --- | --- |
| 1 | **Tenant membership** — does this identity have an account in *this* deployment at all? | Identity core (human-owned) | `idn_users` |
| 2 | **Institution scope** — which college(s), within that tenant, is this identity's authority or relationship confined to? | `OrgPath` containment, or (for guardians) `StudentGuardianRelationship.collegeId` | `ScopeGrant.org` (staff); proposed `StudentGuardianRelationship.collegeId` (guardian) |
| 3 | **Staff authority** — what can this identity DO, as staff, within its scope? | `ScopeChecker` (ADR-0010, human-owned) | `idn_scope_grants` |
| 4 | **Student self-access** — is this identity reading its OWN linked student profile? | The identity link itself, no per-record check | `ppl_students.identity_user_id`, `PeopleDirectory.studentByIdentityUser` |
| 5 | **Guardian-child relationship** — does this identity have a live, authorized relationship to THIS OTHER person's records? | **Proposed new adapter** (this document's subject) | Does not exist yet |

Every one of these is a genuinely different question. Conflating any two of
them is a bug, not a simplification — the sections below say why for each
pair a guardian design is tempted to conflate.

## 1 vs. 2 — tenant membership is not institution scope

Today the codebase has no `tenant` table above `college`
(`packages/modules/people/src/db/schema.ts`); `college` is the top org unit,
and "multi-college deployments work by construction... single-college is the
operative case" (ADR-0014). For a single-college install, tenant and
institution genuinely coincide and this distinction is invisible.

It stops being invisible the moment one guardian has children at two
different colleges under the same subscribing organization — an explicitly
named case in §5.2 ("siblings" — including, per this proposal's reading,
siblings at different campuses of the same school group) and in §8.4's
probe table ("Principal targets another institution inside a tenant:
institution grant remains enforced"). This proposal therefore anchors
`GuardianRecord` at the **tenant** level and `StudentGuardianRelationship`
at the **college** level (entity-model.md), so:

- **Cross-tenant** (a session from an entirely different deployment/customer
  — §8.4: "Session from school A sent to school B: rejected before tenant
  data access") is checked FIRST and denied unconditionally, before any
  relationship lookup even runs.
- **Cross-institution** (same tenant, but the request targets a college the
  guardian has no relationship at) is checked SECOND, per-relationship, and
  is exactly as deniable as cross-tenant but for a different reason — the
  two must produce distinguishable decision reasons (`denied:cross-tenant`
  vs. `denied:cross-institution`) so an incident review can tell "wrong
  deployment entirely" from "right deployment, wrong campus" apart.

This proposal does not require adding a real `tenant` table today — the
codebase's implicit "one deployment = one tenant" is a valid degenerate case
of this model. It requires that the guardian adapter's contract *carries* a
`tenantId` distinctly from `collegeId` now, so that if/when true multi-tenant
hosting arrives, guardian access does not need to be redesigned — only the
tenant resolution step does. See open-decisions.md.

## 2 vs. 3 — institution scope is not staff authority

A `class_teacher`'s `ScopeGrant` targets a class inside a college — that is
institution scope AND staff authority bundled into one row, because for
staff, ADR-0010 deliberately makes authority follow scope. A guardian has
institution scope (they may legitimately interact with College A) without
ever acquiring staff authority there. Nothing in this proposal's adapter
reads or writes `idn_scope_grants`, and nothing in `ScopeChecker` reads or
writes a `StudentGuardianRelationship`. They are parallel, not layered.

**The "guardian who also holds a staff role" case exists specifically to
prove this.** A teacher who is also a parent at the same school has a real
`ScopeGrant` (as staff) and a real `StudentGuardianRelationship` (as a
parent) that happen to share an `identityUserId`. Neither may widen the
other: their guardian decision for their own child must come out identical
to any other parent's, and their staff decision for their assigned class
must come out identical to any other teacher's, with no interaction term
between the two evaluations.

## 3 vs. 5 — staff authority is not guardian-child relationship

This is ADR-0022's lesson one level further out. `ScopeChecker.check()`'s
`covers()` answers "can this grant reach this org path" — a one-directional
containment question keyed to an org tree position. Guardian access is keyed
to a **specific student**, via a relationship table that has nothing to do
with the org tree's shape; a guardian is never "in" the college the way a
teacher is. Reusing `ScopeChecker` for guardian access would require either:

- adding a `"guardian"` role and a `ScopeGrant`-shaped row per child (rejected
  — this is precisely the "broad... scope as a shortcut" §5.2 forbids, and it
  would make a guardian's authority look, to every other module's containment
  check, exactly like a teacher's or a class_teacher's, which it categorically
  is not), or
- adding student-identity-shaped predicates to the shared, human-owned
  checker (rejected — ADR-0012/0016 forbid Fable edits there without the
  full exception process, and even with that process, ADR-0022 already
  warns that widening the shared checker to serve one caller's odd shape
  leaks authority for every other caller).

Hence: a **separate, additive adapter** (`GuardianAccessAdapter`,
`guardian-contract/types.ts`), called *alongside*, never *instead of*,
`ScopeChecker` in any future handler that serves both staff and guardians.

## 4 vs. 5 — student self-access is not guardian access, even for the same child

`packages/modules/portal/src/handlers.ts` states its own invariant plainly:
*"SELF-SCOPE, BY CONSTRUCTION: every handler resolves the caller's student
through the identity link and never reads a studentId from the request —
... the link is the authority."* That pattern is correct for a student
reading their own data and **wrong** for a guardian, for one structural
reason: a student has exactly one linked profile, but a guardian may have
several children. A guardian-facing endpoint *must* accept a `studentId`
(or an equivalent "which child" selector) and *must* run a real,
resource-scoped authorization check against it — it cannot fall back to "the
link is the authority" the way the student portal does, because the link
alone (identity → guardian record) does not say *which* child is meant.

This is also why "one guardian can switch between two linked children"
(§5.2's acceptance criterion) is a first-class capability here rather than
an accident of the self-scope pattern: the "child selector" is not a UI
convenience layered on top of an otherwise self-scoped API — it is the
adapter's `studentId` parameter, checked fresh on every request, exactly
once per request, for exactly the child named.

## The composition point for a future implementation

A future handler that must serve both staff and guardians (e.g., an
attendance-summary read reachable by a class teacher OR a parent) is
proposed to look like:

```ts
if (principal is staff-shaped) {
  decision = scopeChecker.check(principal, "read", resourceRef);
} else if (principal is guardian-shaped) {
  decision = guardianAccessAdapter.check(guardianPrincipal, "read", guardianResourceRef);
} else {
  decision = { granted: false, reason: "unrecognized principal kind" };
}
```

Two adapters, one dispatch, deny-by-default on anything that matches
neither — never one adapter stretched to answer a question it was not built
to answer. Which principal shape a real HTTP request actually carries (a
new `Principal.kind`? A separate authenticated-guardian type entirely?) is
squarely inside the protected boundary and is left to the identity owner —
see open-decisions.md.
