# Analytics threat model (Vidya #5)

Extends the #1–#4 threat models. The asset is the same student data — but
analytics is the **subtlest leak surface in the platform**, because an
aggregate can disclose an individual value without ever showing a row. The
headline threat is inference, not access.

## STRIDE deltas (leak-focused)

| Threat | Vector | Mitigation | Residual / planned |
|---|---|---|---|
| **I**nfo disclosure | Aggregate over records the caller can't read (a dept average to a teacher) | Constituent-closure at serve time: every aggregate is checked with the constituent ResourceRef(s); cross-subject aggregates check EVERY subject explicitly. Storage of blind-computed rollups is not disclosure. Executed against the real matrix (unit + integration). | Human verification of the worked examples is an explicit acceptance item |
| Info disclosure | **Small-N inference** — "class average" over 1 student = that student's mark; differencing a cohort of N vs N−1 | Unconditional minimum-cohort rule (K=5, ADR-0018): any aggregate over < K distinct students is withheld for EVERY role, closure or not. `cohortSufficient` takes no principal — no privileged bypass. Applies to rollups, monthly points AND register-strip cells. | K is a blunt instrument; true differential privacy is a later-tier concern if fine-grained public stats are ever exposed |
| Info disclosure | **Cross-subject differencing** — a subject teacher knows their component, so a class "overall" leaks the rest | The overall is denied unless the caller reads every constituent subject; the live per-student overall appears only when NO mark was filtered out. Integration-proven with a math + physics teacher. | — |
| Info disclosure | At-risk list padding fields the caller can't justify | Field-gating: attendance component by section coverage; per-subject scores by subject scope; overall + low-marks reason only under closure; zero-visible-reason entries omitted | — |
| Info disclosure | Stale rollup reveals a moved student's old node | Flags/rollups store position at compute time; the live per-student view (always current, per-record filtered) is one click away; ≤24h staleness documented | Transfers between the nightly run and a query show old rollups until rebuild — acceptable, non-leaking (still scope-checked) |
| Info disclosure | UI exposing more than the API | The UI is a pure same-origin API consumer holding no privileged path; tiles come from the grants-derived dashboard endpoint (nothing to hide client-side) | — |
| **T**ampering | Rollups edited to mislead | Derived-only: a rebuild regenerates everything from #4; the recompute route is admin-gated and audited; the nightly rebuild audits counts | Raw analytics tables are not a source of truth — never "corrected" by hand |
| **R**epudiation | Disputed at-risk flagging | Rebuilds audit thresholds + counts; flags are reproducible from source records | — |
| **D**oS | Rebuild cost at college scale | Keyset paging (5k), single-pass fold, atomic replace per year; nightly; on-demand is admin-only | Partition by year if a deployment crosses ~10M source rows (shared with #4's note) |
| **E**oP | Serving an aggregate without the closure check | The ONLY serving path is QueryService, which routes every slot through `aggregation-scope.ts` (100%-gated); handlers return designed states, never raw numbers, on denial | The heuristic "no serve outside the closure surface" lint remains recorded debt |

## The minimum-cohort rule, in one line

> An aggregate over fewer than **5** distinct students is never a number —
> it is the string "cohort too small to summarise", for everyone.

## Deferred

Predictive/AI risk scoring (later tier — brings its own inference surface),
public/anonymized statistics (would need real differential privacy),
report-card exports (#6 — a new disclosure surface with its own review),
student/parent self-service analytics.
