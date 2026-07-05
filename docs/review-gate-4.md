# Post-Service Review Gate — Vidya #4 (inputs to a HUMAN approval decision)

Evidence for reviewers, not self-approval. "Verified" = executed by the
author (Windows, Node 22, pnpm 11.9); integration/compose/CI run in CI —
the human gate.

## ⚠ THE flagged item: the scope-integration proofs

Per the assignment, the worked traces must be verified against the actual
matrix **by a human**:

1. Read `packages/modules/academics/src/scope-traces.test.ts` (11 traces,
   ~150 lines) side-by-side with the matrix (ADR-0010/0013 and the
   human-owned `scope-checker.ts`). The traces run against the REAL
   checker via `createIdentityCore` — no double — with refs built by the
   module's actual builders. Verdict table: docs/security-review.md
   #worked-scope-traces.
2. Read `packages/modules/academics/src/resource-refs.ts` (one page,
   100%-coverage-gated) — the file a wrong line in which would leak marks.
3. Confirm the live re-verification in
   `tests/integration/academics-flow.int.test.ts`: two real teachers
   (math/physics) with #3-derived grants hit the cross-subject wall on
   read AND write; class_teacher writes attendance but not marks; admin
   reads but writes nothing academic.

**#4 required ZERO edits to the human-owned core** — ADR-0016 honored; the
one place a change was tempting (assessment-type taxonomy) was resolved by
design instead (fixed enum, ADR-0017 decision 3).

## Architecture review

- academics is a standard #1-contract module: `acd_` tables (denormalized
  org paths, CHECK'd enums, RESTRICT marks→assessment), 14 routes, 1 job,
  forward+rollback migration. Cross-module reads go through #3's new
  read-only PeopleDirectory and #1's new `readAuditEventsForResource` —
  both additive public-API extensions; no module touches another's tables
  (ownership check green across all four prefixes; deep-import probes
  covered by the same lint as before).
- New conventions established for later modules: ResourceRef builders in
  one gated file; row-filtering lists by per-record scope; all-or-nothing
  bulk writes with per-entry reasons.

## Security review

docs/security-review.md#worked-scope-traces (the executed table),
docs/threat-model-academics.md. Grade-change integrity: entries and
corrections audit before/after + actor into the append-only log; the
history endpoint reassembles a mark's trail and is scope-checked like the
mark. Attendance writers are class_teachers (matrix consequence, ADR-0017
decision 2 — subject-teacher attendance would be a human-gated matrix
change and was not made).

## Performance review

docs/performance.md (#4): class-sized operations are tens of ms; scope
row-filtering is in-memory; gap scan is two queries; year-scale row growth
bounded by narrow indexes, with partitioning recorded as the ~10M-row
trigger.

## API review

14 operations under /api/v1/academics (53 total across four modules), all
auth-required (zero public), role gates mirroring the matrix (attendance
writes → class_teacher; marks writes → teacher), uniform problem+json,
422s carry per-entry reasons. OpenAPI regenerated from the same zod
schemas; drift check green.

## Test coverage summary

- **Unit: 377 tests, 40 files — executed, green.** Global gate ≥80%
  (measured 91.9% lines / 85.8% branches). Security gates: 100% on
  `resource-refs.ts`, 95% on `academics/src/service/**` (plus the
  existing identity/derivation gates) — all passing. The 11 worked traces
  run in unit against the real checker.
- **Integration: academics-flow.int.test.ts (7 tests; suite now 6 files)
  — written, NOT executed locally (no Docker); CI runs it.** Full
  provisioning chain (#2 users → #3 teachers/assignments/derived grants →
  #4 records), the cross-subject wall live, attendance write/read split
  live, admin read-not-write live, the grade-change trail through the
  real audit table, and the gap-scan job.
- **Not executed by the author:** compose, images, CI itself (commands in
  README).

## Technical debt added

| Item | Why accepted | Trigger |
|---|---|---|
| `score <= maxScore` is service-enforced, not a DB trigger | Cross-table; raw-SQL writers already bypass audit (restricted-roles item covers them) | The restricted-DB-roles hardening work |
| checkScope heuristic lint still convention + tests | Three modules now share the exact call-site shape — the lint has a spec | Before #5 adds a fourth copy |
| Attendance/marks tables unpartitioned | ~1–2M rows/year is comfortable | ~10M rows in one deployment |
| Mark-history merges two audit queries in the handler | Simple, correct at current volume | An audit-query service if more modules need histories |
| No approval workflow for post-hoc grade changes | hod's `approve` verb is reserved and unused | The institution's exam-office rules (future feature) |

## Future risks

1. **This module's conventions will be copied** — the ref-builder +
   row-filter patterns are now the template; the planned lint should
   enforce what is currently discipline.
2. Report cards/analytics will want bulk reads across scopes — they must
   come as a scope-aware read-model service, not raw table access; the
   academics public service is deliberately empty until then.
3. Audit volume grows with every marksheet (one event per bulk write, not
   per mark — bounded, but the audit table's growth now tracks academic
   activity; the #1 partitioning note applies sooner).

## Items requiring human action before acceptance

1. **Verify the trace file against the matrix** (items 1–3 above) — the
   assignment's explicit human gate.
2. Run integration + compose on a Docker machine; CI end-to-end.
3. Confirm ADR-0017 decisions 2 (class_teacher-only attendance writes) and
   3 (fixed assessment taxonomy) match institutional practice.
4. Decide whether the score<=max DB trigger and the checkScope lint are
   #5 prerequisites or backlog.
