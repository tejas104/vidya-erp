# Guardian access — S03 proposal archive

**Status: historical proposal.** ADR-0027 was accepted on 2026-09-23 and
guardian identity, relationships and the family routes are implemented. Read
ADR-0027 and the current code for binding decisions; the proposal text below
records the earlier design review and may describe work as still pending.

This directory is a design proposal for guardian (parent/family) access to
pupil records, prepared per strategy plan §5.2/§5.3/§8 and the S03
assignment brief. It exists so the identity owner has something concrete to
review, correct, and ratify **before** any production authorization code,
role, session, or route is written.

Nothing here changes production behavior. No file under
`packages/modules/identity/src/core/`, `packages/platform/src/auth/types.ts`,
any database schema/migration, any route, or any frontend file is touched by
this proposal. The executable material in
`packages/modules/people/src/guardian-contract/` is new, additive, and
imported by nothing in production — see that directory's own `index.ts`.

## Why a proposal, not an implementation

The current role vocabulary (`packages/platform/src/auth/types.ts`) has no
guardian role, and `ScopeChecker` — the platform's one authorization
chokepoint — is human-owned (ADR-0012, ADR-0016): Fable does not add roles to
it, extend its matrix, or invent a parallel mechanism that quietly does the
same job. Guardian access is also not simply "one more role" — ADR-0022
already established that *containment* (can this principal act on this
record) and *audience-matching* (is this principal in this record's
audience) are different relations needing different predicates. Guardian
access is a **third** relation — "does this specific person have a live,
authorized relationship to this specific child" — that is neither. Inventing
it correctly, on paper, before code, is the point of S03.

## What's in this directory

| File | Deliverable | Content |
| --- | --- | --- |
| [entity-model.md](entity-model.md) | 1 | Guardian entity and student-guardian relationship model |
| [permission-matrix.md](permission-matrix.md) | 2 | Guardian operations and the staff operations that manage guardian relationships |
| [lifecycle.md](lifecycle.md) | 3 | Invitation → verification → activation → revocation → recovery → relationship lifecycle, with authorized actors per transition |
| [boundaries.md](boundaries.md) | 4 | Tenant membership vs. institution scope vs. staff authority vs. student self-access vs. guardian-child relationship — five distinct questions, never conflated |
| [open-decisions.md](open-decisions.md) | 8 | What still needs the identity owner's judgment, and where the protected boundary sits |

The executable half of this proposal lives in
[`packages/modules/people/src/guardian-contract/`](../../../packages/modules/people/src/guardian-contract/README.md):
a typed adapter contract (deliverable 6) and a machine-readable conformance
case set with explicit expected decisions (deliverable 5), plus tests that
check the *specification's* internal consistency and required-case coverage
(deliverable 7).

## What this is not

- **Not evidence that guardian access works in production.** The conformance
  cases in `guardian-contract/cases.ts` are data. The adapter in `types.ts`
  is an interface with no method bodies. Nothing here enforces anything.
  Passing `cases.test.ts` proves the specification is internally consistent
  and covers the required scenarios — it proves nothing about any future
  implementation until that implementation is run against the same cases
  and a **named human has read and understood the code** (ADR-0012's
  standard: conformance is necessary, not sufficient).
- **Not an ADR.** Every decision below is labeled PROPOSED. Adopting any of
  it — a new role literal, a new session concept, a new table, a new route —
  requires the identity owner's explicit review and ratification, following
  the same standing process ADR-0016 already establishes for edits near this
  boundary.
- **Not a shortcut.** This proposal does not grant guardians any existing
  staff role, any existing student self-access rule, or any `ScopeGrant`.
  Strategy §5.2 says plainly: "Never grant a guardian a broad teacher,
  student, or school-level staff scope as a shortcut." Every case in this
  proposal that could be satisfied by such a shortcut is instead written to
  fail if the shortcut is taken — see `guardian-contract/cases.ts`, the
  "privilege-escalation guards" section.

## Source material this proposal is grounded in

- Strategy plan §5.2 (student and guardian records), §5.3 (parent/older
  student experience), §8.4 (minimum containment and failure probes —
  several rows there name this exact feature: "Guardian relationship revoked
  during active session," "Parent changes child identifier in URL and body").
- ADR-0010 (role + scope model), ADR-0012 (human-owned security core),
  ADR-0014 (org model), ADR-0015 (grant derivation), ADR-0016 (change
  control for the human-owned boundary), ADR-0022 (containment vs.
  audience-matching), ADR-0023 (school edition org tree), ADR-0024
  (module-owned role rules).
- `packages/platform/src/auth/types.ts` (the `Principal` / `ScopeChecker` /
  `ResourceRef` shapes this proposal deliberately mirrors, without touching).
- `packages/modules/portal/src/handlers.ts` (the existing student
  self-access pattern — "the link is the authority" — and why it does not
  generalize to guardians; see boundaries.md).
- `packages/modules/identity/src/core/conformance/scope-checker.ts` (the
  existing conformance-suite convention this proposal's
  `describeGuardianAccessConformance` harness deliberately mirrors).
