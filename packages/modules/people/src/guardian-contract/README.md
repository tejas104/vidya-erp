# guardian-contract (S03, PROPOSED)

The executable half of the guardian-access proposal. Full context, entity
model, permission matrix, lifecycle, and open decisions live in
[`docs/architecture/guardian-access/`](../../../../../docs/architecture/guardian-access/README.md)
— read that first.

- `types.ts` — the proposed entities and a typed `GuardianAccessAdapter` /
  `InvitationAdapter` contract. Interfaces only; no implementation.
- `cases.ts` — machine-readable conformance cases with explicit expected
  decisions, plus `describeGuardianAccessConformance` /
  `describeInvitationConformance` — test harnesses for a **future**
  implementation to run this specification against. Neither harness is
  invoked anywhere in this repository today.
- `cases.test.ts` — validates the case data itself (structural consistency,
  required-scenario coverage, privilege-escalation invariants). Never
  constructs or calls an adapter implementation.

Nothing here is imported by `../index.ts` (the people module's public API)
or by any handler, route, or database code.
