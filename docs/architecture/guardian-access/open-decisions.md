# Open decisions and protected implementation seams

**Status: PROPOSED input to a future ADR.** Nothing on this page is decided.
It is the list of judgment calls this proposal deliberately did not make,
either because they cross the human-owned boundary (ADR-0012/ADR-0016) or
because they are school-policy questions this codebase should not
hard-code (§5.2/§5.4's repeated warning against baking in one school's
policy as if it were universal).

## Seams inside the protected boundary — identity owner must decide, Fable must not

1. **How does a guardian authenticate at all?** The closed `ROLES` array
   (`packages/platform/src/auth/types.ts`) has no guardian entry, and this
   proposal does not add one — that file, "production roles," is explicitly
   out of this assignment's boundary and is exactly the kind of edit
   ADR-0016's full exception process exists for, not a default this proposal
   should reach for. At least three shapes are plausible and this proposal
   takes no position:
   - a new `Role = "guardian"` literal, with `ScopeGrant`/`ScopeChecker`
     left untouched (a guardian holds the role but zero grants; all their
     actual authority comes from the new adapter, never from `covers()`);
   - a `Principal.kind` addition (today `"user" | "service"`) — e.g.
     `"guardian"` — sidestepping the role vocabulary entirely;
   - an entirely separate authenticated-principal type for guardian-facing
     routes, never unified with `Principal` at all.
   Each has different blast radius on `AccessRequirement.rolesAnyOf`,
   session shape, and every existing `roles.includes(...)` call site. This
   is the single highest-leverage decision blocking any implementation.

2. **Session model for relationship changes.** ADR-0010's invariant —
   "every role/scope/status change invalidates the user's sessions... takes
   effect at next login, never mid-session" — is implemented via
   `SessionManager.invalidateAllForUser` (human-owned,
   `packages/modules/identity/src/core/`). That primitive is **all-or-nothing
   per user**. A guardian with two children whose relationship to Child A is
   revoked should almost certainly keep their session and their access to
   Child B — full logout on every single-child revocation would be a poor,
   probably-abandoned-by-users experience for a routine school action (a
   family moves one child to another section's teacher, say). This proposal
   recommends resolving revocation promptness (§5.2: "removes access
   promptly, including an existing session") by having any future
   implementation **fetch relationships fresh per request** rather than
   trust a session snapshot — the `GuardianAccessAdapter` contract is
   already pure and takes relationships as an input parameter
   (`GuardianPrincipal.relationships`) precisely so either strategy fits it
   without a contract change. Whether that recommendation is accepted, or
   whether the identity owner instead wants a new, finer-grained
   invalidation primitive (`invalidateForRelationship`?) added to the
   human-owned `SessionManager`, is the identity owner's call, not this
   proposal's.

3. **Extending `ScopeChecker` vs. a fully separate adapter.** boundaries.md
   argues for "separate, always" today. If a later, larger redesign of the
   platform's authorization surface happens anyway (e.g., `ScopeChecker`
   grows a generic "relationship-based" predicate the way ADR-0022 already
   flags as the eventual home for `orgOverlaps()`), guardian access could
   move onto it then — but that is itself a human-owned-core change under
   the full ADR-0016 process, not something this proposal should pre-empt by
   guessing at that future shape now.

4. **CSRF, session cookie, and route wiring for guardian-facing endpoints.**
   Entirely inside "session handling" and "existing portal routes," both
   explicitly out of this assignment's boundary. Not addressed here at all.

## School-policy questions — deliberately left as a parameter, not a default

5. **Which relationship types require `staff-verified` before reaching
   `active`, versus which may reach `active` on `self-attested` alone?**
   entity-model.md leaves this open per relationship type. A reasonable
   default (self-attested is enough for a first parent, staff-verification
   required for a third or fourth adult linked to one child) is a school
   configuration decision, not a code constant.

6. **Which `GuardianRecordCategory` set does `other-authorized-contact` get
   by default?** permission-matrix.md proposes "a school-configured subset"
   without naming one. Needs a product decision, likely per-school
   configurable rather than hard-coded once, matching §5.4/§8.2's repeated
   instruction not to hard-code a policy every school should be able to set.

7. **Invitation TTL, OTP provider, and recovery mechanism.** All explicitly
   deferred to "the authentication owner" by §5.3 itself. This proposal only
   constrains the *properties* those choices must have (single-use,
   short-lived, never satisfiable by public facts about the child) — never
   the vendor or exact duration.

8. **Whether `class_teacher` may revoke a relationship**, symmetric with
   inviting one (permission-matrix.md, Part B) — flagged there as narrower-
   by-default pending confirmation.

9. **Historical-access window length after transfer/graduation**
   (`historicalAccessUntil`) — a retention-and-product decision, not an
   authorization-shape decision; §8.2's data-retention-schedule work should
   set this, not this proposal.

## What this proposal is confident enough to NOT list as open

These are treated as settled recommendations a future ADR can adopt or
explicitly override, but that this proposal does not think need further
debate to be worth building toward:

- Guardians never receive `export`, ever (permission-matrix.md).
- A guardian relationship's authority is per-student, never bulk, never
  self-expandable (permission-matrix.md, boundaries.md §4-vs-5).
- Guardian record fields exclude identity documents by default
  (entity-model.md, quoting §5.2 directly).
- Revocation and expiry are audited and history-preserving, never a delete
  (entity-model.md, lifecycle.md).
- Phone/email are contact channels, never identity keys, and never drive
  automatic merging (entity-model.md).

## Acceptance for moving past S03

Per ADR-0012's standard, applied here: passing
`guardian-contract/cases.test.ts` demonstrates the *specification* is
internally consistent and covers the required scenarios. It is **necessary,
not sufficient**, for accepting this proposal. Acceptance additionally
requires a named identity-owner human to have read entity-model.md,
permission-matrix.md, lifecycle.md, and boundaries.md, resolved or
explicitly deferred each item above, and recorded that as a ratified ADR —
exactly the process ADR-0016 already established for the last time this
boundary needed to move.
