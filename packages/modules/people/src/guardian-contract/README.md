# guardian-contract (S03 design, now implemented)

ADR-0027 ratified the design. `adapter.ts` now implements the decision
function, `adapter.test.ts` runs the conformance cases, and `GuardianService`
loads fresh relationships and calls it in production. The original entity
model, permission matrix, lifecycle, and open decisions live in
[`docs/architecture/guardian-access/`](../../../../../docs/architecture/guardian-access/README.md)
— read that first.

- `types.ts` — the typed `GuardianAccessAdapter` / `InvitationAdapter` contract.
- `cases.ts` — machine-readable conformance cases with explicit expected
  decisions and the conformance harnesses run by `adapter.test.ts`.
- `cases.test.ts` — validates the case data itself (structural consistency,
  required-scenario coverage, privilege-escalation invariants). Never
  constructs or calls an adapter implementation.
- `adapter.ts` — the current pure implementation, called through the people
  module's guardian service.
