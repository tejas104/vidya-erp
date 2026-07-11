# Reporting threat model (Vidya #6)

Extends the #1–#5 threat models. Reporting adds no new *data* — it re-renders
#4/#5 data as downloadable artifacts. The new risks are therefore about the
**artifact as a disclosure surface**: broken access control on download,
generation that outruns the requester's scope, and the artifact *format*
attacking the recipient (CSV/Excel formula injection). The asset is the same
student data; the headline threats are IDOR and client-side execution.

## STRIDE deltas (artifact-focused)

| Threat | Vector | Mitigation | Residual / planned |
|---|---|---|---|
| **I**nfo disclosure | A report renders records the caller can't read ("a document is exempt") | A report is assembled ONLY through #5's `AnalyticsReadModel` + #4's read model, inheriting constituent-closure, the K=5 cohort rule and at-risk field-gating unchanged (ADR-0020). Reporting owns no direct-record query and never re-derives scope. | Any new report kind must route through the same surface — a report that reads records directly is a review-blocking bypass |
| Info disclosure | **Generation privilege escalation** — a system actor runs the worker job, so it could over-read | The request stores the requester's scope snapshot (roles + grants); the worker generates AS that principal. The artifact can never exceed what the requester could see. | — |
| Broken access control | **IDOR on download** — guess/lift another user's `reportId` and fetch the artifact | The object key is a random UUID but is NEVER the access boundary. Download requires `requested_by === caller` AND a fresh `canProduce` re-check of the caller's CURRENT scope; 403 before any bytes are read. Every download audited. Proven in unit + integration (a real second user gets 403). | — |
| Broken access control | Requester's grant is revoked between request and download | Download re-runs `canProduce` against current grants, not the snapshot — a now-out-of-scope requester is denied even for their own old report. | — |
| **T**ampering (recipient-side) | **CSV/Excel formula injection** — a name like `=cmd|'…'` executes on open | Every CSV cell passes through `escapeCsvCell` (100%-gated): apostrophe-prefix dangerous leaders (`= + - @ \t \r`), then RFC-4180 quote. `renderCsv` has no raw-cell path. Integration-proven with a student literally named `=Ravi`. | PDF draws text, not formulas — no equivalent vector |
| Info disclosure | Small-N leak smuggled into a "document" | The cohort rule is inherited from #5 and printed honestly as a withheld-cohort note in the artifact — a report shows *why* a figure is absent, never a bare number below K. | — |
| **S**poofing / **R**epudiation | Who generated/downloaded what | Both `reporting.report-generated` and `reporting.report-downloaded` are audited with actor + kind + format + scope; the request itself is audited (`reporting.report-requested`). | — |
| Info disclosure | **Artifact retention** — old PDFs/CSVs linger in object storage after a transfer/graduation | Access is re-checked on every download, so a stale artifact is not a bypass (an out-of-scope requester can't fetch it). Lifecycle/TTL expiry of `rpt_reports` + objects is recorded debt. | Add a retention sweep (job) before large-scale rollout |
| **D**oS | Expensive report floods the worker | Generation is a queued worker job (202 + poll), off the request path; failures are captured on the row, not retried into a storm. Per-report cost is bounded by the requester's scope. | Global rate-limit on report requests is shared with the platform-wide #2 note |
| **E**oP | Rendering path reaches around the read model | `collectReport` is the only assembler and takes only the read model; `renderPdf`/`renderCsv` receive a plain `ReportData` and cannot fetch anything. | The "serve only through the surface" heuristic-lint debt (since #4) covers this too |

## The reporting rule, in one line

> A report is a disclosure surface with the same rules as a live view — no
> exemption because it is "a document", no access because you hold the URL.

## Deferred (out of #6 by the assignment)

Formal report-cards / transcripts (a heavier, signed-artifact surface),
scheduled/emailed reports (a delivery surface with its own recipient-trust
model), retention/TTL automation for artifacts (recorded debt above),
report-designer templates (arbitrary layouts reopen ADR-0021), and any
export to student/parent audiences (a new disclosure population needing its
own review).
