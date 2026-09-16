# School fee correctness — S04 investigation and evidence report

Date: 2026-09-16. Scope: `packages/modules/fees/` as it exists on
`codex/school-r01-sonnet`, against strategy plan §5.7 (fees and minimum
financial correctness) and §5.8 (online fee payments, read for context only
— no gateway work was in scope or performed).

**This is a bounded correctness review, not a certification.** It reproduces
and (where possible without a schema/API change) fixes specific defects
against invariants the strategy plan or the module's own code already
promises. It does not audit authorization exhaustively, does not review
frontend behavior, and does not claim the module is production-ready or
financially certified. Passing the tests referenced here demonstrates the
specific properties they check, not the absence of other defects.

**S03 review status disclosure.** This assignment's stated prerequisite —
"S03 must be complete and its Astra review must have no unresolved blocking
findings" — could not be verified: no Astra review artifact for S03 exists.
The only review document on disk (`.worktrees/school-astra-review-02/review/REVIEW.md`)
is explicitly scoped to "T01, T02, S01 and S02" and predates S03 entirely.
Per this session's standing instruction ("if a review gate is missing, do
not assume it passed"), this is disclosed rather than assumed satisfied.
The user was asked and explicitly directed this work to proceed regardless;
S04 is therefore **also** unreviewed by Astra as of this report.

## Method

Per the assignment's instructions, findings below are classified into four
buckets, and the two "defect" buckets are backed by a **real Postgres
database** (a disposable, synthetic-data database created and migrated by
the test file itself — no mocked transaction behavior for any concurrency
or atomicity claim):

- **Verified invariant** — reproduced against real data and holds.
- **Reproduced and fixed** — a real gap against a promise the strategy plan
  or the module's own contract already makes; fixed within the existing
  schema and API shape (no migration, no breaking change).
- **Reproduced, not fixed** — a real gap against an explicit promise, where
  a correct fix needs a schema or API change out of this assignment's
  boundary. Documented with the exact proposed change.
- **Missing capability** — the plan describes something genuinely unbuilt.
  Not represented as a "bug"; no contract currently promises it exists.

Evidence lives in [`tests/integration/fees-repo.int.test.ts`](../../tests/integration/fees-repo.int.test.ts)
(11 tests, all passing, run three times consecutively with no flakiness)
and [`packages/modules/fees/src/definition.test.ts`](../../packages/modules/fees/src/definition.test.ts) /
the amended [`handlers.test.ts`](../../packages/modules/fees/src/handlers.test.ts).

## Verified invariants

| # | Investigation area | Finding |
| --- | --- | --- |
| 1 | Currency precision | Every amount is an integer number of paise (`money.ts`); no floating-point arithmetic exists anywhere in the money-math or repo layer. Confirmed by inspection and by the existing `money.test.ts` golden-number suite (unchanged). |
| 3 | Tenant/institution containment | `invoicesForCollege` and all invoice reads filter by `collegeId`; the receipt-counter table is keyed per college. Real-DB test: two colleges' invoices and receipt sequences coexist with zero cross-contamination — college B's first payment gets receipt `1` regardless of how many payments college A has already recorded (`fees-repo.int.test.ts`, "tenant/institution containment"). |
| 4 | Receipt-number allocation under concurrency | Eight **real, concurrent** `recordPayment` calls against the same college produce receipt numbers `[1..8]` — no gaps, no duplicates — via the existing `for("update")` row lock on `fee_receipt_counters` (`fees-repo.int.test.ts`, "receipt numbering under real concurrency"). |
| 6 | Partial-payment allocation | A payment less than the invoice amount correctly yields status `part`; a payment (or sum of payments) meeting or exceeding it yields `paid`. Covered by the pre-existing `money.test.ts` suite (unchanged, re-run clean). |
| 6 | Invoice-generation idempotency (a form of retry safety) | `createInvoicesForStructures`' `(studentId, structureId)` unique index makes re-running invoice generation for the same pairs a no-op. Real-DB test: inserting the identical pair twice leaves exactly one row (`fees-repo.int.test.ts`, "invoice-generation idempotency"). |
| 9 | Audit evidence | Every state-changing fee route (`head-create`, `head-delete`, `structure-create`, `invoices-generate`, `payment-record`, `adjustment-add`) declares an `audit` action in `definition.ts`; `defineRoute` refuses to register a state-changing route without one (a build-time guarantee, `platform/src/http/define-route.ts:190-194`), and each fees handler returns the `resourceId`/`details` that guarantee needs. Confirmed by inspection of all six route declarations and by a direct check that `paymentRecord`'s return value carries a non-empty `audit.resourceId`. End-to-end "audit row actually written" is `defineRoute`'s own separately-verified guarantee (not re-proven here, since these tests call handlers directly and bypass that wrapper — see the test file's own note). |
| 10 | Atomicity when a later operation fails | Forced a **real** unique-constraint collision on `fee_payments(college_id, receipt_no)` at the LAST step of `recordPayment`'s transaction (after the receipt counter had already been read-locked and was about to be advanced). The whole transaction rolled back: the counter still reads its pre-attempt value, and no orphan payment row exists (`fees-repo.int.test.ts`, "atomicity when a later operation fails"). |

## Reproduced and fixed defects

### F1 — refunds could exceed the amount actually paid (strategy §5.7, §8.4)

**Promise:** "A refund must not exceed the refundable amount after prior
refunds; concurrent requests must preserve that invariant" (§5.7,
Acceptance); "Two concurrent refunds: Combined refund never exceeds
eligibility" (§8.4).

**Reproduction (pre-fix, confirmed by running the same scenario against the
unmodified `addAdjustment`):** paying ₹1,000 against an invoice, then
recording a `refund` adjustment of ₹5,000, succeeded unconditionally. The
resulting ledger showed `effectivePaidPaise = -4,000` and `duesPaise`
correspondingly inflated by ₹4,000 — a fabricated debt with no real-world
counterpart. Two concurrent ₹1,000-paid, ₹5,000-refund-each requests would
both have succeeded, for a combined refund ten times the eligible amount.

**Fix** (`packages/modules/fees/src/repo.ts`, `addAdjustment`): after
acquiring the invoice's `for("update")` row lock (already present, for the
existing status recompute) and before inserting a `refund`-kind adjustment,
the current ledger is recomputed and the refund is rejected with a new
`RefundExceedsEligibleError` (mapped to `409` in `handlers.ts`, documented
in `definition.ts`) if it would exceed `effectivePaidPaise`. Because the
check runs strictly after the row lock, two concurrent refund requests
against the same invoice **serialize** on that lock: the second transaction
only proceeds once the first has committed, and therefore sees the first's
refund in its own eligibility computation.

**Regression evidence:**
- `fees-repo.int.test.ts`, "refund eligibility" (4 tests): a within-limit
  refund succeeds; an over-limit refund is rejected with `409` and leaves
  **zero** adjustment rows (no partial effect); cumulative refunds across
  separate requests are tracked correctly (₹300k then ₹200k+1 rejected,
  exactly ₹200k accepted); two refunds of ₹300k each **issued concurrently**
  against a ₹500k-paid invoice produce exactly one `201` and one `409`, and
  the sum of recorded refunds never exceeds ₹500k.
- `handlers.test.ts`, "answers 409 when a refund exceeds the amount
  eligible for refund" (mock-level, confirms the handler's error mapping
  independent of the database).

**Not changed:** `scholarship`/`fine` adjustments have no analogous ceiling.
The strategy plan makes no equivalent explicit promise for those kinds (no
"a scholarship must not exceed X" sentence exists), and inventing one would
be inventing a concession policy this assignment is explicitly barred from
doing. Flagged as a **missing capability**, not a defect, below.

### F3 — numeric bounds: an oversized amount crashed instead of failing validation cleanly

**Investigation area 1 (currency precision and numeric bounds).**
`paiseSchema` (`definition.ts`) was `z.number().int().positive()` — no
ceiling. Every fee amount column (`fee_structures.amount`,
`fee_invoices.amount`, `fee_payments.amount`, `fee_adjustments.amount`) is
Postgres `integer`, whose range ends at 2,147,483,647. A caller-supplied
amount above that range passed validation and only failed at INSERT time,
uncaught, as a raw driver error surfacing through `defineRoute`'s generic
`catch` as an opaque `500` — not the clean `400` a malformed request should
produce.

**Fix:** `paiseSchema` now caps at `MAX_PAISE_AMOUNT = 2,000,000,000`
(₹2,00,00,000 — comfortably beyond any realistic single school-fee line
item, with ~147 million paise of headroom under the column's real limit).
Non-breaking: every previously-valid amount (anything a real fee could be)
still validates identically; only values that would have crashed the
server are now rejected with a clean `400` instead.

**Regression evidence:** `definition.test.ts` (11 tests) — accepts ordinary
amounts and the exact cap, rejects one paisa over the cap, rejects a value
one past Postgres's actual `integer` ceiling, and confirms the cap itself
sits under that ceiling with margin. Pre-existing behavior (rejects
non-positive/non-integer amounts) reconfirmed unchanged.

## Reproduced, not fixed — needs an approved schema change

### F2 — duplicate/retried payment submission creates a second receipt

**Promise:** "duplicate submission does not create a second receipt" (§5.7,
Acceptance, verbatim).

**Reproduction (real DB, current code, unmodified by this assignment):**
submitting the identical `{invoiceId, amountPaise, mode, ref}` payment body
twice in sequence — the same shape a client retry after a timeout, or a
double-tapped submit button, would produce — succeeds both times, creating
**two** `fee_payments` rows with **two different receipt numbers** for what
was meant to be one real-world payment. `fees-repo.int.test.ts`, "duplicate
submission" pins this exact behavior with a real database and is left
**green on the CURRENT (defective) behavior** — it is a characterization
test, not an endorsement; its assertions and comments say so explicitly.

**Why this was not fixed this round:** the only sound way to recognize "this
is the same submission, not a new payment" is a client-supplied idempotency
token the server can deduplicate on. The current `fees.payment-record`
request body (`invoiceId, amountPaise, mode, ref`) has no such field, and
`ref` cannot safely stand in for one — it defaults to `""`, is not unique,
and two *legitimate* cash payments on the same day plausibly share it. Doing
this correctly needs an API field and a matching database uniqueness
constraint, i.e. a schema and (additive, non-breaking) API change — both
explicitly out of this assignment's boundary ("do not introduce schema
migrations or breaking API changes... document the exact proposed change
and leave that specific item for an approved follow-up").

**Proposed follow-up (for approval, not implemented here):**
1. Add a nullable `idempotency_key text` column to `fee_payments`, with a
   **partial** unique index `UNIQUE (college_id, idempotency_key) WHERE
   idempotency_key IS NOT NULL` (nullable so existing rows and clients that
   don't yet send a key are unaffected — additive, non-breaking).
2. Add an optional `idempotencyKey: z.string().min(1).max(128).optional()`
   field to `fees.payment-record`'s request body (optional — additive, not
   a breaking change to existing callers).
3. In `recordPayment`, when a key is supplied: inside the same transaction,
   before allocating a receipt number, check for an existing payment with
   that `(collegeId, idempotencyKey)`. If found, return it as-is (no new
   receipt, no new row) instead of proceeding — "one monetary effect with
   stable retry response," matching §5.7's phrasing precisely and the
   parallel promise in §5.8 for gateway webhooks.
4. This is additive and backward compatible: a caller that never sends a
   key gets exactly today's behavior (documented, not silently changed).

## Missing capabilities (not defects — no existing contract promises these)

These are described in §5.7 as things the fees module should eventually do,
but nothing in the current code claims to do them, so their absence is not
a bug relative to any existing promise:

- **Cheque received/cleared/bounced status.** `paymentModeSchema` has no
  `"cheque"` value at all, and no payment carries a settlement sub-status.
  §5.7: "Maintain explicit statuses for a cheque received versus cleared or
  bounced. Do not mark a cheque-cleared balance merely because a receipt
  was printed." Building this correctly needs a new `settlementStatus`
  column (or equivalent) on `fee_payments` and is a genuine feature, not a
  fix to existing behavior — proposed as its own, separately-scoped
  assignment.
- **Receipt numbering per financial year.** §5.7: "Define receipt numbering
  per legal entity and financial year." `fee_receipt_counters` is keyed by
  `collegeId` alone — receipt numbers run forever, never resetting per
  year. A correct fix needs `fee_receipt_counters`'s primary key widened to
  `(college_id, financial_year)` (or equivalent) — a migration, proposed
  for a follow-up, not attempted here.
- **Day-close report.** §5.7 describes a daily reconciliation (opening
  balances, collections by mode, cancellations, refunds, settlement
  references, closing totals, differences). No route, handler, or service
  function of any kind exists for this. Entirely unbuilt; not a defect.
- **Bounced-cheque reopening a balance**, **backdating/edits-after-close
  authority**, **disputed/held amount display**, and the **accountant
  export with stable fee-head mappings** (§5.7) are all likewise unbuilt.
- **Online/gateway payments** (§5.8) are explicitly out of this
  assignment's boundary ("do not add a payment gateway") and were not
  investigated beyond confirming no gateway integration exists to
  investigate.
- **Scholarship/fine ceilings.** No cap exists on how large a `scholarship`
  or `fine` adjustment may be relative to the invoice. Unlike refunds, the
  strategy plan makes no explicit promise here — treated as a policy
  decision for a school/product owner, not something this assignment should
  invent a limit for.

## Observations (neither defect nor missing capability — noted for context)

- **Overpayment is allowed and marks the invoice `paid`**, with the
  ledger's true (negative) `duesPaise` clamped to `0` in the API view
  (`invoiceViews` in `handlers.ts`). `money.ts`'s own docstring treats a
  negative `duesPaise` as an intentional "overpaid" representation, so this
  is an existing, documented design choice, not a defect — but it does mean
  the API response hides *how much* is owed back to the family once
  overpaid. Worth a product decision on whether to surface it; not changed
  here since nothing promises otherwise.
- **`fees.collection-summary` reports gross payments**, not netted against
  refunds recorded in the same window. This is consistent with "collection
  totals by mode" as a distinct concept from a full day-close reconciliation
  (which §5.7 describes separately, and which does not exist yet — see
  above); not treated as a defect in the existing endpoint's own terms.

## Commands run and results

| Command | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` (in `packages/modules/fees`) | exit 0 |
| `pnpm exec tsc --noEmit -p tsconfig.json` (root — covers `tests/**`) | exit 0 |
| `pnpm exec vitest run --project unit packages/modules/fees` | **40/40 passed** (money 12, definition 11, generate-job 2, handlers 15) |
| `pnpm exec vitest run --config <ad-hoc, uncommitted config>` targeting `tests/integration/fees-repo.int.test.ts` against a real local Postgres (native install, `postgres:postgres@localhost:5432`, disposable database `vidya_s04_fees_test`, migrated with only the fees module's own migration) | **11/11 passed**, run three consecutive times with no flakiness |
| `git diff --cached --check` | clean |

**On the integration-test harness:** this repository's shared
`tests/integration/global-setup.ts` migrates *every* module into
`vidya_integration` and currently fails in this environment — unrelated to
fees — on `analytics/0000_analytics` ("syntax error at or near NULLS",
consistent with a Postgres version older than the migration assumes on this
particular native install). Fixing that is out of this assignment's
boundary (shared configuration/another module's migration). The fees
integration test instead performs its **own** scratch-database creation and
runs **only** the fees module's migration in its own `beforeAll` — it needs
no shared setup and was run via a temporary, uncommitted vitest config
pointed at that one file. The committed test file itself has no dependency
on that workaround; it would run identically under the shared harness once
the unrelated `analytics` migration issue is fixed for this environment.

## Commit SHAs

- Starting SHA (S03 commit, this assignment's predecessor): `9ac4630cd63774e571e84988fd04435d8609c1eb`
- Fix + regression-test commit (F1, F3, evidence test file): `fc158c1f5f2f240e176e282140216bdc9e89a7a9`
- Evidence report commit (this document): recorded as the resulting SHA in the top-level response accompanying this report (committed separately, per the instruction to keep fixes and the report in separate commits when that improves review)

## Remaining risks and limitations

- **F2 (duplicate submission) remains live in production behavior.** A
  network retry or a double-submitted form still creates two receipts today.
  This is now precisely documented and evidenced, with a scoped migration
  proposal, but it is **not fixed**.
- **No cheque/settlement modeling, no day-close report, no per-year receipt
  numbering** — all as described above.
- This review did not examine the frontend, did not review
  `apps/web`'s fee screens, and did not test the invoice-generation worker
  job (`generate-job.ts`) end-to-end against a queue — only its underlying
  repo-level idempotency guarantee, directly.
- Authorization coverage relies on the existing `handlers.test.ts` mock
  suite (unchanged, still passing) plus this assignment's own containment
  check at the repo/data level; it does not re-verify `ScopeChecker`'s
  human-owned matrix itself (out of this module's ownership).
- The scratch database `vidya_s04_fees_test` (native Postgres,
  `localhost:5432`) was left in place after this investigation — disposable,
  synthetic data only, safe to drop at any time.
