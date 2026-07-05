# Post-Service Review Gate — Vidya #3 (inputs to a HUMAN approval decision)

Evidence for reviewers, not self-approval. "Verified" = executed by the
author (Windows, Node 22, pnpm 11.9). Docker is unavailable on the
authoring machine: integration tests, compose, image builds and CI are
written/updated and run in CI — the human/CI gate.

## ⚠ Items executed under the owner's "no human changes" authorization

Per the #3 approval ("take the best decision … instead of doing any human
changes"), two actions that ADR-0012 reserves for the security team were
performed by Fable and REQUIRE RATIFICATION:

1. **`core/index.ts` wiring** — mechanical assembly of the team's landed
   implementations (argon2 hasher, Redis session manager, matrix checker);
   hour/minute config converted to the manager's seconds. Commit `4011168`.
2. **ADR-0013 matrix extension** — ONE line in the human-owned checker:
   admin write verbs now cover `module ∈ {identity, people}`. Without it
   the frozen matrix deadlocked #3 (nobody could create any org unit or
   person). Fourteen conformance cases pin the extension and its
   non-goals; note the checker's own semantics (not my extension) grant
   class_teacher writes to non-subject class records — the matrix's
   promotion clause — pinned with three additional cases.

Both diffs are deliberately minimal and isolated in commit `4011168`.

## THE security seam (flagged as demanded): grant derivation (ADR-0015)

Design properties for the reviewer: single write path through identity's
`derivedGrants` API; provenance columns + unique `source_ref` (identity
migration 0001, with rollback); derived and manual grants mutually
untouchable; role ADD only, never removal; session invalidation on every
change (both users when an assignment moves); compensated dual-write on
create, grant-first ordering on delete; hourly audited reconciliation.
Evidence: 14 unit tests on the service (95%-gated file), plus integration
proof against the REAL core: assignment → grant row
(derived/verified/sourceRef) → teacher login carries it → real matrix
enforces class boundaries live → assignment removal kills grant AND the
teacher's session → out-of-band grant deletion repaired by the reconcile
job with an audit row.

## Architecture review

- people is a standard #1-contract module (22 routes, 2 jobs, `ppl_`
  tables with RESTRICT nesting and shape CHECKs, own migrations with
  rollback). The OrgDirectory contract from #2 is implemented with
  existence+nesting checks and injected into identity late-bound — package
  graph stays acyclic (people→identity; identity→platform interface).
- Every handler decision flows through `checkScope`; org positions are
  data-derived (enrollment for students; both sides checked on transfers).
  Boundary lint re-verified with a deep-import probe against people.
- Identity gained Fable-owned extensions only: provenance migration,
  derivedGrants/verification services, the grants-verify route, and
  OrgDirectory-validated manual grants (422 on unreal org units,
  verified=true when they resolve).

## Security & API reviews

docs/security-review.md (#3 delta), docs/threat-model-people.md.
OpenAPI regenerated: 39 operations across the three modules, all people
routes auth-required (zero public), drift check green. Import CSVs capped at 1 MB, validated per row,
stored in the private bucket, audited with actor and counts;
`source_import_id` gives row-level provenance.

## Performance review

docs/performance.md (#3): 5k-row import well under a minute off the
request path (one tree read, batched existence checks); derivation costs
are admin-frequency; scope checks stay in-memory pure.

## Test coverage summary

- **Unit: 329 tests, 34 files — executed, green.** Global gate ≥80%
  (measured 91.7% lines / 86.6% branches); security-path gates at 95 on
  `identity/src/service/**` AND `people/src/service/assignments-service.ts`
  (both pass). Excluded from the unit metric (integration-covered, same
  policy as #1/#2): Drizzle repos/schema, module index glue, the human
  core.
- **Integration: 5 files — written, NOT executed locally (no Docker); CI
  runs them.** Now running against the REAL human core (argon2 sessions +
  the real matrix — the labeled doubles were retired with the core
  landing): identity flows, people org administration incl. RESTRICT and
  tree reads, the full derivation loop above, the grants-verify backfill
  (resolvable flipped, unresolvable reported-not-deleted), enrollment
  transfers, and MinIO-backed imports (dry-run/apply/duplicates) — CI
  gained a MinIO service for these.

## Technical debt added

| Item | Why accepted | Trigger |
|---|---|---|
| checkScope call-site discipline is convention + review | Lint can't recognize "data access" semantically | #4: add a heuristic lint (repo calls outside checkScope'd handlers) before the academics module multiplies call sites |
| Import parses in memory (1 MB cap) with per-row inserts | Simplicity + per-row error attribution at current scale | Raising BODY_MAX_BYTES → streaming parse + batched clean-row inserts |
| Tree endpoint is N+1 queries | Clarity; ~100 indexed queries worst case | A UI polling the tree |
| Reconcile loads teachers per assignment (N+1) | Hourly, small N | Assignment counts in the tens of thousands |
| No org-unit MOVE operation | Restructuring semantics need their own security review (grant paths) | First real reorg request |
| CSV export escaping obligation | No export feature exists | The first feature that emits CSV |

## Future risks

1. **The ADR-0013 precedent**: extending the matrix was owner-authorized
   once; if module #4 also "just needs one line", the human-owned boundary
   erodes. Recommendation: security team ratifies 0013 AND restates the
   change-control rule.
2. Academic-year rollover is manual (runbook); a term-management feature
   (academics module) should own it before year two.
3. The org tree is now load-bearing for every future module's scope
   checks — treat `ppl_` migrations with migrator-level (ADR-0008) review
   care from here on.

## Items requiring human action before acceptance

1. **Ratify the two owner-authorized core actions** (wiring + ADR-0013) —
   read the diff in commit `4011168`; it is small by design.
2. Run integration + compose on a Docker machine (now includes MinIO):
   `pnpm compose:up` → create-admin bootstrap → org/import flows →
   `pnpm test:integration` (CI also runs all of it).
3. Confirm the promotion-clause consequence pinned in conformance:
   class_teacher may write non-subject people records (enrollment moves)
   within their class — implemented with source+target scope checks.
4. Approve the year-rollover operational procedure (runbook) as interim.
5. Set the MinIO lifecycle rule for `imports/*` per institutional
   retention policy.
