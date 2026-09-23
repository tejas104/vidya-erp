# ADR-0027: Guardian identity and authorization

- **Status:** PROPOSED — awaiting owner ratification of Decision 1. Decisions
  2–9 are proposed for acceptance in the same act.
- **Date:** 2026-09-23
- **Supersedes:** nothing. **Resolves:** the open items in
  `docs/architecture/guardian-access/open-decisions.md`.
- **Blocks:** every parent-facing surface (roadmap slices 1.4 onward).
- **Ratified by:** _(unratified — name and date to be recorded here)_

## Context

The S03 proposal (`packages/modules/people/src/guardian-contract/`, plus
`docs/architecture/guardian-access/`) specifies guardian access completely at
the type level and pins it with passing conformance cases. It deliberately
stops short of nine judgment calls. The gate-04 review recorded guardian
access as "not implemented — expected boundary", and required that
"authentication shape, relationship revocation semantics, policy defaults and
the identity boundary need an ADR before implementation."

This ADR makes those calls.

Two facts were established by reading the code, not the proposal documents,
and they change the shape of the answer:

**Finding A — a `guardian` role literal would force an edit to the protected
core.** `ROLES` (`packages/platform/src/auth/types.ts:15`) is consumed by
`switch (grant.role)` in `packages/modules/identity/src/core/scope-checker.ts`,
which is CODEOWNERS-reserved to the security team and has no outer `default`
arm. Adding a literal makes that switch non-exhaustive, so Option A of
open-decision #1 cannot be taken without an ADR-0016 **exception** — owner
authorization for that specific change, conformance cases pinning the new
behaviour *and* its non-goals, and human ratification.

**Finding B — the protected core never switches on `Principal.kind`.** A
grep of `identity/src/core/**` returns no `.kind` use outside tests. So
extending `kind` costs **zero** edits to the protected boundary.

That asymmetry is decisive: the governance cost of these options differs by
more than their technical merit does.

## Decision 1 — a guardian is a distinct principal kind, not a role

**REQUIRES OWNER RATIFICATION. This is the item the gate-04 review named as
the single highest-leverage blocker, and ADR-0016 §4 forbids self-ratification
of decisions on this boundary even when, as here, the recommended option does
not itself edit a protected file.**

`Principal.kind` gains `"guardian"` alongside `"user"` and `"service"`. A
guardian principal carries:

- `roles: []` — always empty,
- `grants: []` — always empty,
- `id` = their identity user id,

and **all** of their authority flows through `GuardianAccessAdapter`, never
through `ScopeChecker`.

### Why this is the safe option, structurally

A guardian principal cannot satisfy any existing staff authorization check,
because every one of them keys on roles or grants:

- `AccessRequirement.rolesAnyOf` cannot be satisfied by an empty `roles`.
- Every `roles.includes(...)` call site is false.
- `GrantMatrixScopeChecker.check` iterates `caller.grants` and falls through
  to `deny-by-default` when it is empty.

So a guardian is fail-closed against the entire existing surface **by
construction**, not by remembering to add a check. Adding a role literal would
do the opposite: it would place guardians inside the grant-role vocabulary,
where a future `case "guardian":` arm in the human-owned matrix is one edit
away from granting them staff authority.

### One exception that must be named, not assumed

`GrantMatrixScopeChecker.check` is not unconditionally deny-for-guardians. Its
first branch is a self-access escape hatch:

```
action === "read" && resource.ownerUserId === caller.id  ⇒  granted
```

A guardian principal therefore retains read on records **they themselves
own**. This is correct (a guardian reading their own guardian record), and it
never reaches a pupil's records, whose `ownerUserId` is the pupil's identity
user. It is recorded here so that no future reader mistakes "empty grants" for
"unconditionally denied", and so that a conformance case pins it.

### Rejected alternatives

| Option | Rejected because |
|---|---|
| **A — `Role = "guardian"`** | Forces an ADR-0016 exception on the protected `scope-checker.ts` (Finding A). Worse, it models a guardian as a holder of scope grants when they hold none, and puts them one `case:` arm away from staff authority. Maximum governance cost for the weakest safety story. |
| **C — a fully separate `GuardianPrincipal`, never unified with `Principal`** | Cleanest conceptually, and it was close. Rejected because `AuthnDecision` returns `Principal`, so this widens a platform union and forks the `defineRoute` pipeline — every middleware, audit writer and request logger grows a second shape. Option B gets the same isolation from the *authorization* surface without forking the *transport* surface. Revisit if guardian routes ever need a genuinely different request lifecycle. |
| **Reusing the `student` role** | Guardians are not pupils, their authority is per-relationship rather than self-ownership, and one adult may hold authority over several pupils. Conflating them would make revocation semantics incoherent. |

### Non-goals of Decision 1

- `ROLES` is **not** extended. No new role literal exists.
- `ScopeChecker`, `covers()` and the grant matrix are **not** modified.
- `identity/src/core/**` is **not** edited. If implementation discovers that
  it must be, work stops and returns to the owner under ADR-0016's full
  exception process.

## Decision 2 — relationships are read fresh per request, never from a session snapshot

Accepted as the proposal recommends. `GuardianPrincipal.relationships` is
built per request from the database, not snapshotted into the session at login
the way staff grants are.

Rationale: ADR-0010's "changes take effect at next login" is implemented by
`SessionManager.invalidateAllForUser`, which is all-or-nothing per user. A
guardian with two children whose relationship to one child is revoked must
keep working for the other. Forcing a full logout on every single-child
revocation is a bad experience for a routine school action, and schools would
route around it.

Consequence, stated plainly: this costs one relationship query per
guardian-facing request. That is the price of prompt revocation, and it is
accepted. **No new invalidation primitive is added to the human-owned
`SessionManager`.**

## Decision 3 — the adapter stays separate from `ScopeChecker`, indefinitely

Accepted as `boundaries.md` argues. Guardian access is a third authorization
relation alongside containment and audience-matching, not an extension of
either. Revisit only if the platform's authorization surface is redesigned
wholesale, which is itself a human-owned change.

## Decision 4 — guardian routes reuse the existing session and CSRF machinery

Guardian-facing routes are ordinary routes: same cookie, same CSRF layers,
same `TRUSTED_ORIGINS` origin guard, same audit pipeline. Only the
authenticator that produces the principal and the adapter that authorizes it
differ.

Non-goal: no separate auth domain, no token scheme, no second cookie.

## Decision 5 — verification thresholds are school configuration, with a shipped default

A relationship may reach `active` on `self-attested` alone for the **first two
adults** linked to a pupil. A **third or subsequent** adult requires
`staff-verified`.

This ships as a default, **stored as configuration rather than a constant**, so
a school can tighten it (all relationships staff-verified) or loosen it
without a code change. `other-authorized-contact` always requires
`staff-verified`, in every configuration — that one is not loosenable.

## Decision 6 — `other-authorized-contact` defaults to a narrow category set

Default grant: `attendance`, `notices`, `timetable`. Never `marks`,
`report-card`, `fees`, or `guardian-relationship`.

School-configurable upward per relationship, staff-recorded, audited. The
default is deliberately the set a person collecting a child from the gate
needs, and nothing that discloses academic standing or money.

## Decision 7 — invitation properties fixed; vendor deferred

- Single-use, **72-hour** TTL, delivered to a staff-recorded contact channel.
- Never satisfiable from facts a stranger could know about the child
  (admission number, class, date of birth are **not** sufficient).
- Re-issuing invalidates the prior invitation.

OTP provider and recovery mechanism remain deferred to the notification
adapter work; this ADR fixes the properties, not the vendor.

## Decision 8 — `class_teacher` may invite, may not revoke

A class teacher may invite a guardian for a pupil in their own class.
Revocation is **admin-only**, because revocation is the safety-critical
direction: a wrongly-issued invitation is caught at verification, whereas a
wrongly-revoked relationship silently cuts a parent off from their child's
record.

## Decision 9 — historical access is 90 days after exit

`historicalAccessUntil` defaults to 90 days after a pupil's transfer or
graduation, read-only, limited to records that already existed at exit.
Configurable per school; superseded by the data-retention schedule when that
work lands.

## Consequences

**Unblocked for implementation** once Decision 1 is ratified: the guardian and
relationship tables (`ppl_` prefix), the invitation lifecycle, the pure
`GuardianAccessAdapter` implementation against the existing contract, the
guardian authenticator, and the parent portal reusing the `portal` module's
read models behind the adapter.

**Buildable before ratification**, because it touches neither authentication
nor the protected core: the adapter's pure decision logic, which is already
fully specified and case-tested and which nothing calls until wiring happens.

**Not addressed here:** notification delivery, the parent mobile app, and
consent/opt-out state — all separate slices.

## Ratification

Per ADR-0016 §4, ratification is a human act; this document may be prepared but
not self-ratified. To accept, a named person records their name and the date in
the header above, having read this ADR together with
`docs/architecture/guardian-access/{entity-model,permission-matrix,lifecycle,boundaries}.md`.

Acceptance of Decision 1 additionally asserts that extending `Principal.kind`
is understood to be a platform-type change that does **not** touch
`identity/src/core/**`, and therefore requires a normal ADR rather than an
ADR-0016 exception. Should implementation prove otherwise, it stops and
returns here.
