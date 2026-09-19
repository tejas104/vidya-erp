# School fee correctness — S04 investigation and evidence report

Date: 2026-09-16, second pass 2026-09-19 (F4, F5, OpenAPI drift, receipt
and display consistency — see "Second pass" below). Scope: `packages/modules/fees/` as it exists on
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
(12 tests after the second pass, all passing)
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
| 9 | Audit evidence (see also F4, F5) | Every state-changing fee route (`head-create`, `head-delete`, `structure-create`, `invoices-generate`, `payment-record`, `adjustment-add`) declares an `audit` action in `definition.ts`; `defineRoute` refuses to register a state-changing route without one (a build-time guarantee, `platform/src/http/define-route.ts:190-194`), and each fees handler returns the `resourceId`/`details` that guarantee needs. Confirmed by inspection of all six route declarations and by a direct check that `paymentRecord`'s return value carries a non-empty `audit.resourceId`. End-to-end "audit row actually written" is `defineRoute`'s own separately-verified guarantee (not re-proven here, since these tests call handlers directly and bypass that wrapper — see the test file's own note). |
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

## Second pass (2026-09-19)

Re-audited the first pass against the full S04 brief (money bounds, tenant
containment, receipt allocation, retries, refunds/reversal, stored vs
displayed vs receipt totals, transactional audit). Also re-ran the F1
reproduction as a **mutation check**: disabling the refund guard in
`addAdjustment` turns 3 of the 12 integration tests red (over-limit,
cumulative, concurrent refund); restoring it returns 12/12.

### F4 — fee mutations wrote audit events with no organization (fixed)

**Contract:** ADR-0025 (accepted 2026-09-14): institution audit history
returns only rows whose `org` is set; "new institution-visible actions must
attach the resolved resource `OrgPath` to their audit result."

**Defect:** none of the six fee mutation handlers set `audit.org`, so
`sys_audit_log.org` was `NULL` for every payment, refund, waiver, fine,
scholarship, fee head, structure and generation run. Those events were
therefore **invisible** to the institution's own audit history (they failed
closed, so this was a missing audit trail, not a cross-tenant leak).

**Reproduction:** `handlers.test.ts`, "attaches the resource OrgPath to every
fee mutation's audit record" — failed on the pre-fix handlers (`received:
undefined`); the `fees-repo.int.test.ts` audit test now also asserts the
payment audit carries the invoice's real `{collegeId, departmentId,
classId, sectionId}` read from Postgres.

**Fix** (`handlers.ts`): payment/adjustment attach the invoice's full org
path (already computed for the write check); structure-create and
invoices-generate attach the class path; head create/delete attach
`{collegeId}`. No schema, API or platform change.

**Mutation proof:** reverting only `handlers.ts` makes exactly the unit
case (40/41) and the integration audit case (11/12) fail; restoring returns
41/41 and 12/12.

**Not re-proven here:** that `SystemAuditLogger` persists `event.org` and
that the scoped read returns it — that is ADR-0025's own integration test
(`tests/integration/audit-scope.int.test.ts`), which needs the shared
harness (Redis) and was **not run** in this session.

### F5 — audit write happens after the payment commits (reproduced, not fixed — platform boundary)

**Invariant:** Constitution rule 7 as implemented in `defineRoute`: "a
failed audit write fails the request (fail-closed)."

**Defect:** `defineRoute` calls the handler first; `recordPayment` /
`addAdjustment` commit their own transaction; only then is
`auditLogger.record` called, on a separate connection. If that write fails,
the client gets `500` but the payment, its receipt number and the invoice
status change are already committed, with **no audit row**. A client that
treats the 500 as "not recorded" and retries creates a second payment
(compounding F2).

**Reproduction:** `fees-repo.int.test.ts`, "F5 … characterizes the current
gap" — real `defineRoute` + real fees handler + real Postgres, only the
audit sink throws: response `500`, yet `fee_payments` has 1 row and the
receipt counter is at 1. Green on the **current** behavior, by design (a
characterization test to flip when fixed).

**Why not fixed here:** a correct fix makes the audit insert part of the
money transaction (e.g. an `AuditLogger.record(event, tx)` variant, or a
handler-owned outbox row committed in the same tx). That changes the
platform audit seam and `defineRoute`, which are shared platform code
outside this assignment's ownership. Proposed follow-up: add a
transaction-aware audit write to the platform seam, have fees write its
audit row inside `recordPayment`/`addAdjustment`, and let `defineRoute`
skip its post-handler write for routes that declare they audited in-tx.

### Contract drift — committed OpenAPI spec was stale after fc158c1 (fixed)

`pnpm openapi:check` failed: `fc158c1` added `maximum: 2000000000` to
amount fields and the `409` response on `fees.adjustment-add`, but did not
regenerate `docs/openapi/openapi.json`. Regenerated with `pnpm
openapi:generate`; the diff contains only those fee changes. Note for
review: the `maximum` narrows accepted input, but only values that
previously crashed with a 500 at INSERT time.

### Areas checked with no new defect

- **Money precision/rounding:** all arithmetic is integer paise;
  `formatRupees` (`(paise/100).toFixed(2)`) is exact for integer paise (the
  float error of `paise/100` is far below the 0.005 rounding threshold at
  any value the ₹2 crore cap allows). JS sums stay exact (far below 2^53).
  **Untested assumption:** per-invoice sums of payments/fines are not
  bounded, but no amount column stores a sum, so they cannot overflow
  Postgres `integer`.
- **Receipt PDFs:** none exist. The receipt is the web counterfoil
  (`apps/web/app/(app)/manage/fees/page.tsx`, printed via `window.print()`)
  rendering the API's `receiptNo` and `amountPaise` with the web
  `formatPaise`/`formatPaiseInWords`. Frontend was out of scope and not
  changed or tested here; the stored amount is what the counterfoil receives.
- **Stored vs displayed totals:** invoice `status` is persisted and
  `paidPaise`/`duesPaise` are recomputed live from the same ledger function
  (`computeLedger`); both writes recompute status under the invoice row
  lock, so they cannot diverge except for the documented overpayment clamp.
- **Cancellation/reversal:** there is no payment void/cancel route; the
  only reversal is a `refund` adjustment (F1). Nothing further to audit.
- **Lock ordering:** `recordPayment` locks invoice then receipt counter;
  `addAdjustment` locks invoice only. Consistent order, no deadlock path
  found (inspection, not a stress test).

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
- **Institution timezone for date ranges.** `paymentsInRange` treats
  `from`/`to` as UTC calendar days, so an IST payment between 00:00 and
  05:30 is counted on the previous day in `fees.collection-summary`. No
  college timezone exists anywhere in the platform to do better, so this is
  a known ceiling, not a contract breach.
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
| **Second pass (2026-09-19)** | |
| `pnpm exec vitest run --project unit packages/modules/fees/src/handlers.test.ts` before the F4 fix | 1 failed / 15 passed (the new F4 case, `received: undefined`) |
| `pnpm exec vitest run --project unit packages/modules/fees` | **41/41 passed** |
| `pnpm exec vitest run --root . --config <scratch config: include only tests/integration/fees-repo.int.test.ts, no globalSetup>` against local PostgreSQL 14.23, disposable `vidya_s04_fees_test` | **12/12 passed** |
| Mutation: revert `handlers.ts` only | unit 40/41, integration 11/12 (the F4 cases); restored, green |
| Mutation: disable the refund guard in `repo.ts` | integration 9/12 (the 3 F1 cases); restored, green |
| `pnpm openapi:check` | failed (stale), then `pnpm openapi:generate`, then up to date |
| `pnpm test` (all unit) | **92 files, 1067/1067 passed** |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` (eslint + style checks) | exit 0 |
| `pnpm test:integration tests/integration/fees-repo.int.test.ts` (official harness) | **not run — environment**: global setup throws `integration tests require REDIS_URL`; no Redis/shared harness here. Not counted as passing. |

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
- Evidence report commit (first pass): `20e3ca4e0afe84769647531dcc31ee0e8a6138ed`
- Second pass (F4 fix, F5 characterization, OpenAPI regeneration, this update): the commit directly on top of `20e3ca4`

## Remaining risks and limitations

- **F2 (duplicate submission) remains live in production behavior.** A
  network retry or a double-submitted form still creates two receipts today.
  This is now precisely documented and evidenced, with a scoped migration
  proposal, but it is **not fixed**.
- **F5 (audit after commit) remains live.** An audit-sink failure leaves a
  committed payment with no audit row and a 500 that invites a retry.
  Needs the platform audit seam change described above.
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
