# School R01 review gate 04

Date: 2026-09-20

Review branch: `codex/school-astra-review-04`

Integrated submissions:

- Terra T01–T04 through `c768a40126e046fe203555f0991b7c8e52855bc5`
- Sonnet S01–S04 through `25e928d67dd3a38d8ce36c8890a4806f7a348150`
- Review correction: `b0b1a10` (`fix(fees): make payment retries idempotent`)

The source worktrees were not modified. The histories were combined from the shared stabilized base in a new review worktree.

## Verdict

T03/T04 and the previously corrected T01/T02 work meet their assignment boundaries. School terminology, edition-specific help selection, the four authored school help articles, and the terms/marks help entry points are internally consistent and covered by unit/UI tests. The three school Playwright journeys are discovered but were not executed against a live isolated school stack; they are not counted as browser passes.

S01/S02 calculator corrections pass their complete suites. The calculators remain isolated engines and are not yet wired to persistence, routes or report-card generation, which is expected at this checkpoint.

S03 is a proposal and conformance-case catalogue only. It provides no guardian login, route authorization, data persistence or parent-facing product. Its protected identity decisions remain explicitly unresolved and require a ratified ADR before implementation.

S04 found real fee defects. Refund bounds, numeric bounds and institution-scoped audit metadata are correct in the submitted work. The review fixed the highest-impact remaining payment defect: an identical retry can no longer issue a second receipt.

The combined batch is accepted for continued development with one high-priority release blocker: financial writes and their audit rows are not committed atomically. A failed audit sink can leave a committed payment without an audit row until the client retries. Required payment idempotency prevents the retry from charging twice and lets the retry record the original receipt, but it does not provide atomic audit durability when no retry occurs.

## Findings and disposition

### P1 — duplicate payment retry could issue a second receipt — fixed

The submitted S04 tests proved that a repeated payment body created two database rows and two receipt numbers. The correction adds migration `fees/0001_payment_idempotency`, requires a UUID on the payment API, checks it inside the invoice-locked transaction and returns the original payment for an identical retry. Reuse with changed details returns 409. The cashier UI retains the key across an unchanged failed request and rotates it when the payment payload changes.

The migration is additive: historical rows keep a null key, while current API writes require one. Deploy the migration before the application version. Rollback removes only the new index and column; it does not alter existing payment data. The rollback and reapply were verified on the disposable `vidya_s04_fees_test` database.

### P1 — audit persistence happens after financial commit — open release blocker

`defineRoute` invokes the fee handler, the fee transaction commits, then the shared audit logger writes on a separate connection. If the audit write fails, the response is 500 but the monetary change remains committed without its audit row. The payment correction removes the double-charge consequence on retry and a real-route test verifies recovery, but the platform invariant still needs a transaction-aware audit write or durable transactional outbox before a paying-client release.

This is a platform boundary change and should be designed once for all audited mutations. A fee-only import of the system audit table would violate module ownership and was deliberately avoided.

### P2 — live school browser evidence is missing — open verification item

T04's component tests prove the terms and marks help buttons open the school articles and do not fall back to college content. Playwright lists all three affected journeys. They were not run because no isolated school server and disposable seeded database were provisioned; the default suite mutates its configured seed. Run these journeys in the clean-install/staging environment before marking school UI verification complete.

### P2 — guardian access is not implemented — expected boundary

The S03 tests validate case data and privilege invariants; they never invoke an authorization adapter. The proposal correctly does not add a permissive placeholder. Guardian authentication shape, relationship revocation semantics, policy defaults and the identity boundary need an ADR before implementation.

### P2 — school summaries are calculation engines only — expected boundary

Weighted results and attendance summaries have broad pure-function coverage, including malformed input corrections. They are not exported through module public APIs or connected to school records. The report-card integration assignment must source trusted enrollments, calendars, marks and policies rather than duplicating these calculations.

## Security and data review

- Fee mutation authorization still resolves the invoice or organization on the server and applies the existing scope checker before writes.
- Idempotency lookup is scoped to the invoice's trusted college. A key reused for another payload returns a generic conflict and does not reveal the prior payment.
- Receipt allocation and payment insertion remain in one transaction. Identical concurrent retries serialize on the invoice lock, and the partial unique index protects cross-invoice key races.
- Refund eligibility remains checked after the invoice lock, so concurrent refunds cannot exceed net paid value.
- Guardian documents contain no production grants or route wiring. Their recommendations must not be treated as active authorization.
- No secrets, external deployment, push or main-branch merge occurred during this review.

## Verification evidence

- `pnpm exec vitest run --project unit --no-file-parallelism`: 93 files, 1,073 tests passed.
- `pnpm test:ui`: 66 files, 294 tests passed.
- Fee real-Postgres review suite: 14 tests passed, including concurrency, refund bounds, tenant data separation, audit failure recovery and payment idempotency.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed, including color and scale checks.
- `pnpm openapi:check`: passed after regenerating the payment contract.
- `pnpm build`: passed; dual-edition help compiled and the production Next.js build completed.
- `VIDYA_EDITION=school ... playwright ... --list`: three journeys discovered; no live browser execution claimed.
- `fees/0001_payment_idempotency` rollback and reapply: passed on disposable local PostgreSQL.
- `git diff --check`: clean after correcting migration EOF whitespace.

The first parallel unit run produced one failure in the existing login timing-noise test under concurrent CPU load. That test passed immediately in isolation and passed in the serial full suite. No identity code changed in this batch.

## Release order for the correction

1. Back up and verify the target database according to the existing release procedure.
2. Apply `fees/0001_payment_idempotency` while the old application is still compatible with the nullable column.
3. Deploy the application/API/UI version together. The new API requires `idempotencyKey`; there are no released mobile clients in this product phase, so no old mobile compatibility window is required.
4. Monitor payment 409/5xx rates, audit failures and receipt continuity.
5. If application rollback is required, leave the additive column/index in place. Drop them only after the old application is stable and a separate rollback decision is made.

## Required follow-up before a paying-client release

Design and implement transactional audit durability for sensitive writes, then flip the characterization/recovery test into an atomicity assertion. Provision an isolated school stack and execute the T04 school browser journeys. These two items are release evidence, not optional polish.
