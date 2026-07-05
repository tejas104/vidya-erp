# Academics threat model (Vidya #4)

Extends the #1–#3 threat models. New assets: **marks** (the record a
student's future rides on — both confidentiality between teachers and
integrity against tampering), attendance records (defaulter-tracking
evidence), and the audit trail of grade changes (what an examiner or court
asks for).

## STRIDE deltas

| Threat | Vector | Mitigation | Residual / planned |
|---|---|---|---|
| **T**ampering | Grade tampering by the legitimate teacher (quiet post-hoc edits) | Every entry AND correction audits with before/after, actor, timestamp into the append-only log (DB-trigger-protected, #1); `GET /marks/{id}/history` makes the trail one call away; bulk events carry per-entry diffs (capped 100 — the counts always complete) | An approval workflow for post-deadline changes is a future feature (hod's `approve` verb is reserved for exactly this) |
| Tampering | Grade tampering by OTHER roles | Live-verified against the real core: other-subject teachers 403 on read AND write; class_teacher reads but cannot write marks; admin reads but cannot write; hod/principal read-only. The cross-subject wall is integration-tested with two real logged-in teachers | — |
| Tampering | Forging the record's org position (caller-supplied path or subject) | Paths and subjectIds never come from callers: stamped at creation from the PeopleDirectory, then read from the row; the ref builders make attendance-without-subject and marks-with-subject type-level facts | — |
| Tampering | Marks for students not in the class / phantom students | Batch validation against live enrollment positions; all-or-nothing rejection with per-entry reasons | Historical marks survive transfers by design (records of events) |
| Tampering | Score outside range | `score >= 0` + kind/status enums as DB CHECKs; `score <= maxScore` service-enforced on entry and correction (cross-table) | A DB trigger for score<=max would close the raw-SQL hole; deferred — raw-SQL writers already bypass audit and are the runbook's restricted-role item |
| **R**epudiation | "I never changed that grade" | actor + requestId on every change; append-only storage; history endpoint | — |
| **I**nfo disclosure | Cross-subject marks leakage (the assignment's headline risk) | The subjectId bit is load-bearing and enforced by construction (ADR-0017); 11 worked traces run against the REAL checker in unit tests and re-verified live in integration; list endpoints row-filter per record | Human verification of the trace file is an explicit acceptance item |
| Info disclosure | Attendance leakage across classes | Class containment: teachers/class_teachers see their class only (traced); hod department-wide; principal/admin college-wide | Student self-access to their own attendance/marks arrives with portals (later tier) |
| **D**oS | Giant bulk payloads | Entries capped at 500 per request + the global body cap; row-filtered lists capped by query limits | — |
| DoS | Gap-scan hammering | One query per 1k sections + one indexed scan; daily | — |
| **E**oP | Bypassing checkScope in a handler | Same structural controls as #2/#3 + the chokepoint-discipline test (every handler consulted the checker, every ref module="academics"); the ref-builder file carries a 100% coverage gate | The heuristic lint remains recorded debt (now three modules of precedent for its shape) |

## Deferred

Approval workflows for grade changes (hod `approve`), report cards/
transcripts (with their own redisclosure controls), student/parent portal
access, exam scheduling, analytics.
