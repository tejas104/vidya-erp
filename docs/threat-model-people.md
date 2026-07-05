# People & org threat model (Vidya #3)

Extends docs/threat-model.md and docs/threat-model-identity.md. New
assets: the org tree (whose identifiers anchor EVERY scope decision),
student/teacher records (PII), the assignment→grant derivation machinery,
and imported CSVs at rest in MinIO.

## STRIDE deltas

| Threat | Vector | Mitigation | Residual / planned |
|---|---|---|---|
| **T**ampering | Privilege escalation by editing the org tree (e.g. moving a class under a different department to widen a hod's reach) | Org writes are admin-role + scope-gated + audited; RESTRICT deletes prevent silent restructuring; grants store full paths at issue time, so a moved unit NARROWS to mismatch (fails closed) rather than widening | Tree moves aren't modeled at all yet (rename/delete only) — a future "reorg" feature needs its own review |
| Tampering | Privilege escalation via assignments (the new write path to grants) | Assignment writes are admin+scope gated and audited; derivation can only mint teacher/class_teacher grants, class-level, in the assignment's own class; it can never mint admin/principal/hod authority; manual/derived grants are mutually untouchable | An admin remains able to grant classroom authority freely — that is their job; audit review is the control |
| Tampering | Drift between assignments and grants (the classic dual-write hazard) | Compensated writes (row rolled back on grant failure), fail-closed ordering on delete, hourly audited reconciliation, unique source_ref | Window between drift and the next reconcile run (≤1h); shorten via on-demand run if it ever matters |
| Tampering | Malicious CSV content (formula injection for later spreadsheet export, oversized fields) | zod per-row validation caps lengths; values stored verbatim, never interpreted; API responses are JSON only. Formula-injection risk applies to future CSV **export** features — flagged for the module that builds one | Export-side CSV escaping is a recorded obligation, not built |
| **R**epudiation | Disputed imports ("who loaded these 800 students?") | ppl_imports rows carry requestedBy; import completion/failure audited with counts; every created row carries source_import_id | — |
| **I**nfo disclosure | Roster/PII exposure beyond scope | Every read goes through the checker: teachers see their attached classes only (verified against the REAL matrix in integration), hod their department, principal/admin college-wide; students hold no self-service access (no portals yet) | Student PII is minimal by design (name + admission no.) until later tiers add guarded fields |
| Info disclosure | CSVs at rest in MinIO (names + admission numbers) | Bucket is on the private network; objects are only reachable through the app | Object lifecycle/retention policy (delete after N days) is an ops item — runbook notes it; encryption-at-rest per institutional policy |
| Info disclosure | Enumeration via opaque ids | Ids are UUID-based; 404 vs 403 semantics follow #2's decision (403 on scope-denied existing records) | — |
| **D**oS | Giant CSV uploads | Route body cap (1 MB ≈ ~10k rows) + zod max on the csv field; parsing happens in the worker, not the request path; per-row errors capped at 500 | Larger colleges: raise BODY_MAX_BYTES or add multipart+direct-to-S3 upload (future) |
| DoS | Import job hammering Postgres | Batched existence checks; single tree read for section resolution; row inserts are individually cheap; one import runs per job | Concurrency limits per queue default to 5 — set to 1 for imports if contention appears |
| **E**oP | Bypassing checkScope in people handlers | Same structural controls as #2 (route files → composition only; injected checker; every handler audited in review); handler tests assert the checker is consulted with the RIGHT org position (enrollment-derived for students, both sides of a transfer) | Call-site discipline for #4+ remains convention + review; a lint heuristic is recorded debt |
| EoP | class_teacher misusing the matrix's promotion clause | Enrollment moves scope-check BOTH source and target sections — a class_teacher can only move students within/into their own class's scope | — |

## Deferred

Student/parent portals (self-access for students), notifications, org-tree
restructuring tooling, CSV export escaping (with the first export feature).
