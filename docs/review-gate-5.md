# Post-Service Review Gate — Vidya #5 (inputs to a HUMAN approval decision)

Evidence for reviewers, not self-approval. "Verified" = executed by the
author (Windows, Node 22, pnpm 11.9). Integration/compose/CI run in CI —
the human gate. The frontend was additionally screenshotted live.

## ⚠ THE flagged item: the aggregation-scope proof + minimum-cohort rule

Per the assignment, a human must verify with worked examples that a
teacher's dashboard is computed only from scope-permitted records and that
no aggregate reveals an individual value:

1. Read `packages/modules/analytics/src/aggregation-scope.ts` (one page,
   100%-coverage-gated) and `src/aggregation-scope.test.ts` (11 examples,
   run against the REAL human-owned checker). The verdict table is in
   docs/security-review.md#aggregation-scope and ADR-0018.
2. Confirm the cross-subject wall: a math teacher is DENIED the class
   OVERALL average at the physics constituent (unit + integration, two real
   logged-in teachers) — because they know their own component and could
   difference the rest.
3. Confirm the minimum-cohort rule is UNCONDITIONAL: `cohortSufficient(n,k)`
   takes no principal; a below-5 aggregate is withheld even for the
   principal (integration-proven on a 2-student section).
4. Confirm field-gating on at-risk: the math teacher sees the flagged
   student's attendance + math score, never physics or the overall; the
   class_teacher sees the full picture (integration).

**#5 required ZERO edits to the human-owned core** — ADR-0016 honored.

## Architecture review

- analytics is a standard #1-contract module: `anl_` rollup/flag tables it
  owns (derived, not source-of-truth), 5 routes, 1 nightly job,
  forward+rollback migration. It reads source data ONLY via #4's new public
  `AcademicsReadModel` and #3's `PeopleDirectory` — never their tables
  (ownership check green across all 5 prefixes; deep-import probe covered by
  the same lint). Compute is blind (system actor); disclosure is
  serve-time-only.
- New cross-module public extensions, all additive: #4 `AcademicsReadModel`
  (paged, position-carrying record views + section density), #3
  `PeopleDirectory` gains `departmentPath`, `collegeExists`,
  `sectionsOfClass`, `namesFor`, and #1 `readAuditEventsForResource` was
  already added in #4.
- Frontend (ADR-0019): pure same-origin API consumer, no privileged path;
  hand-rolled SVG (no chart lib), self-hosted fonts (no runtime CDN),
  two designed modes, the register-strip signature, designed empty/withheld
  states. Permission-reflective by construction.

## Security review

docs/security-review.md#aggregation-scope, docs/threat-model-analytics.md
(inference-focused: small-N, cross-subject differencing, stale-rollup
position). The subtlest leak surface in the platform, closed by
construction and executed against the real matrix.

## Performance review

docs/performance.md (#5): nightly rebuild is single-pass keyset paging
(5k), atomic per-year replace, minutes at college scale off the request
path; serving is indexed reads + in-memory closure/cohort; ≤24h staleness
with the always-live per-student view as the escape hatch.

## API + frontend review

5 analytics routes (58 total across six modules), all auth-required, zero
public; the one state-changer (recompute) is admin-gated + audited; OpenAPI
regenerated (aggregate slots typed as discriminated union states),
drift-checked. Three UI surfaces (login, dashboard, student) screenshotted
in light + dark; palette validated with the dataviz script in both modes.

## Test coverage summary

- **Unit: 433 tests, 45 files — executed, green.** Global gate ≥80%
  (measured 92.7% lines / 87.2% branches). Security gates: 100% on
  `analytics/src/aggregation-scope.ts`, 95% on `analytics/src/service/**`
  (plus the existing academics/identity gates) — all passing. The 11
  aggregation-scope examples run against the real checker.
- **Integration: analytics-flow.int.test.ts (~10 tests; suite now 7 files)
  — written, NOT executed locally (no Docker); CI runs it.** Full
  provisioning chain (#2→#3→#4) + a real rollup rebuild, then: cross-subject
  wall live, closure for class_teacher/hod, the permission-mirror dashboard,
  field-gated at-risk (math vs class_teacher), the minimum-cohort withhold
  on a tiny section, and the audited recompute route.
- **Frontend: no automated tests (first UI); verified by live
  screenshots.** Typecheck + production build pass; components are pure and
  reuse across pages.

## Technical debt added

| Item | Why accepted | Trigger |
|---|---|---|
| Rollups ≤24h stale after a transfer | Nightly rebuild is the cost/freshness trade; live view is always current | If real-time rollups are ever required (event-driven recompute) |
| `next/font` needs build-time network | CI has it; idiomatic Next | A fully-offline build → `next/font/local` with committed font files |
| No automated frontend tests | First UI; time-boxed | Before the UI grows beyond three surfaces — add Playwright/RTL |
| Dashboard fans out one at-risk query per tile | Grants are few per user | A super-admin with very many grants → a batched at-risk endpoint |
| checkScope/closure "serve only through the surface" is convention + gate | Lint can't see it semantically | The recurring debt since #4 — worth the heuristic lint before #6 |

## Future risks

1. **Analytics is the inference frontier.** Any later feature that widens
   who-sees-aggregates (student portals, public stats, exports in #6) must
   re-derive against closure + cohort — the unconditional K is the safety
   net, but new surfaces need their own review.
2. Predictive/AI analytics (later tier) introduce a new inference surface
   (a model can leak training data) — out of scope here by design.
3. The rollup tables grow with academic activity; the #1/#4 partitioning
   note now applies to `anl_*` too.

## Items requiring human action before acceptance

1. **Verify the aggregation-scope proof + minimum-cohort rule** (items 1–4
   above) — the assignment's explicit human gate.
2. Run integration + compose on a Docker machine; CI end-to-end; then load
   the UI against real data and confirm the permission mirror (a teacher
   logs in and sees only their tiles).
3. Confirm the unconditional-K choice (vs closure-waived) still matches
   institutional expectations now that it is implemented.
4. Decide whether the checkScope/closure lint is a #6 prerequisite.
