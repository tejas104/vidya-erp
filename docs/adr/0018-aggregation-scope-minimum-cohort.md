# ADR-0018: Aggregation scope & the minimum-cohort rule

- **Status:** Accepted — ⚠ the security centerpiece of #5; the worked
  closure/cohort examples are flagged for human verification in
  docs/review-gate-5.md
- **Date:** 2026-07-06

## Context

Analytics are DERIVED from #4's attendance and marks. An aggregate is not
exempt from scope because it is "just a number": a department average a
teacher may not see is still a leak, and — subtler — an aggregate over a
tiny cohort can reveal an individual value by arithmetic. #5 must compute
every figure ONLY from records the caller could read individually, and
must not let a rollup become a side-channel.

## Decision 1 — filter at the source, never aggregate-then-check

- **Live per-student views** pull raw records via #4's public read model
  (which carries each record's stored org path + subjectId) and run the
  ScopeChecker PER RECORD before any arithmetic. A caller's view of a
  student is computed from exactly the rows that student's page would show
  that caller. The overall average appears only when NO record was filtered
  out (closure) — otherwise the caller gets exactly their visible subjects.
- **Precomputed rollups** (nightly job) are computed BLIND — a system actor
  aggregates everything — and each rollup row stores the org position of
  the node it summarizes. **Storage is not disclosure.** Serving is where
  scope is enforced.

## Decision 2 — constituent-closure at serve time

An aggregate is returned iff the caller could read EVERY constituent
record. The check is generalized from #4's resource-refs to the node
(`src/aggregation-scope.ts`, one page, 100%-coverage-gated):

- **Attendance rollups** carry the attendance-record ref (no subjectId).
  Every constituent shares that exact readability, so one check IS
  constituent-closure.
- **Single-subject marks rollups** carry (node, subjectId). One check IS
  closure.
- **Cross-subject marks rollups** are where the shortcut breaks: a class
  "overall average" would otherwise read like a non-subject record a subject
  teacher could see — and since they know their own subject's contribution,
  serving the overall leaks the other subjects by differencing. Closure is
  therefore checked EXPLICITLY per constituent subject; a math teacher fails
  on the physics constituent and never receives the overall.

At-risk entries are **field-gated** the same way: the attendance component
is visible to anyone covering the student's section; each per-subject score
only to that subject's readers; the overall figure and the "low-marks"
reason only under full cross-subject closure. An entry with no visible
flagged reason is omitted entirely.

## Decision 3 — the minimum-cohort rule (unconditional, K = 5)

Every served aggregate computed over fewer than `ANALYTICS_MIN_COHORT`
(default 5) distinct students is withheld and replaced by an explicit
insufficient-cohort state — **for every role, closure or not.**
`cohortSufficient(n, k)` takes no principal by design: there is no
privileged path around it.

Rationale: under today's matrix, closure already makes small-N leakage
impossible (you only ever get aggregates over records you can read). K is
pure defense-in-depth — but making it unconditional means it **fails
closed** against any future consumer that serves aggregates without going
through closure (a student portal, an export, a buggy later module), and
it is trivially explainable to an auditor. The register-strip day-cells and
every monthly-series point are aggregates too, and each is cohort-gated
independently.

## Worked examples (EXECUTED against the real matrix)

`packages/modules/analytics/src/aggregation-scope.test.ts` runs these
against the real human-owned checker; the integration suite re-proves them
over real records with two logged-in teachers:

| Caller / request | Result |
|---|---|
| teacher — own-subject class average | GRANTED |
| teacher — class OVERALL average | DENIED at the physics constituent |
| teacher — class attendance % | GRANTED (reads every constituent row) |
| teacher — department/college aggregate | DENIED (grant doesn't cover node) |
| class_teacher / hod / principal / admin — class overall | GRANTED (closure) |
| any role — aggregate over < 5 students | insufficient-cohort (withheld) |

## Consequences

- The dashboard API is the permission mirror: tiles are derived from the
  caller's grants, so the UI receives only in-scope data and has nothing to
  hide client-side.
- Rollups may be ≤ 24h stale after a transfer (documented); the raw,
  always-current per-student view is one click away.
- Any new aggregate type must be added to `aggregation-scope.ts` (inheriting
  its 100% gate) and this ADR's example table — adding one elsewhere is a
  review-blocking bypass of the closure surface.
