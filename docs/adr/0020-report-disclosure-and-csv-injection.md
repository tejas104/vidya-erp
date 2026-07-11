# ADR-0020: A report is a disclosure surface — scope-filtering, scoped download, CSV-injection escaping

- **Status:** Accepted — ⚠ the security centerpiece of #6; the three
  controls below are flagged for human verification in docs/review-gate-6.md
- **Date:** 2026-07-06

## Context

Reporting (#6) turns live views into artifacts a user can download, keep and
mail. That is a new disclosure surface, and the tempting mistake is to treat
"a document" as exempt from the rules that govern a screen — to render from a
privileged query, hand back an object URL, and call it done. It is not
exempt. A PDF of a class a teacher may not see is the same leak as the screen
they were denied; an artifact reachable by guessing a URL is broken access
control; a CSV whose cells are taken literally by Excel is a code-execution
vector against the recipient. #6 must add none of these.

## Decision 1 — reports read ONLY through #5's scoped disclosure surface

A report contains **exactly what the requester's live view would**, by
construction, because it is assembled solely through the analytics public
read model added for #6 (`AnalyticsReadModel`, a thin wrapper over the
ADR-0018 `QueryService`) plus #4's `AcademicsReadModel`. It therefore
inherits, unchanged and untested-around:

- **constituent-closure** — an aggregate appears only if the caller could
  read every constituent record (cross-subject checked per subject);
- **the unconditional minimum-cohort rule (K=5)** — any aggregate over < 5
  distinct students is withheld, printed honestly in the document as a
  withheld-cohort note, not a number;
- **at-risk field-gating** — attendance by section coverage, per-subject
  scores by subject scope, overall + reason only under closure.

Reporting owns **no query that reaches records directly** and never
re-derives scope. `collectReport` routes every field through the read model;
`renderPdf`/`renderCsv` add nothing and hide nothing — they render the
`ReportData` faithfully, including its withheld/out-of-scope notes. Adding a
report that reads around this surface is a review-blocking bypass.

## Decision 2 — generation runs with the requester's scope; access is checked twice

- At **request time**, `canProduce` runs the same read-model access decision
  the live view would (403 if the target is outside scope, 404 if it does not
  exist) *before* any job is enqueued.
- The request row stores the **requester's scope snapshot** (roles + grants).
  The worker generates with THIS principal — a report can never contain more
  than the person who asked for it could see, even though a system actor runs
  the job.
- At **download time**, access is re-checked from scratch: the caller must be
  the original requester **and** their *current* scope must still cover the
  target (`canProduce` again). A requester whose grant was revoked between
  request and download is denied.

## Decision 3 — the object key is never the access boundary (scoped download)

The artifact lives in MinIO under a random UUID key, but the key is **not a
secret capability**. Download is authorised by Decision 2's re-check, not by
possession of the URL. An authenticated user who guesses or is handed another
user's `reportId` gets 403 before a single byte is read; the object key never
appears in any scope decision. Every download is audited
(`reporting.report-downloaded`), as is every generation
(`reporting.report-generated`).

## Decision 4 — CSV/Excel formula-injection escaping is a REQUIRED control

Student and subject names are free text (`=Ravi` is a valid real name). A
spreadsheet treats a cell beginning with `=`, `+`, `-`, `@`, TAB or CR as a
formula, so an exported name can execute on the recipient's machine (the
classic CSV-injection / "formula injection" attack). Therefore **every CSV
cell** — content, names, free text, notes — passes through `escapeCsvCell`
(`packages/modules/reporting/src/escape-csv.ts`, one page, 100%-coverage-
gated):

1. if the cell begins with a dangerous leader (`= + - @ \t \r`), prefix a
   single apostrophe so the spreadsheet stores it as text;
2. then apply RFC-4180 quoting (`"` … `"`, doubling embedded quotes) if the
   cell contains `"`, `,`, CR or LF.

`renderCsv` has no path that emits a raw cell — the escape is at the single
choke point every value flows through. PDF output (pdfkit, ADR-0021) draws
text, not formulas, so it carries no equivalent risk.

## Worked examples (EXECUTED)

Unit (`reporting/src/escape-csv.test.ts`, `report-service.test.ts`) and
integration (`tests/integration/reporting-flow.int.test.ts`, real Postgres +
MinIO + the human-owned matrix):

| Caller / request | Result |
|---|---|
| requester — report for an in-scope student | GRANTED (202 → generate → download) |
| teacher — report whose target is outside their scope | 403 at request (read-model denied) |
| another authenticated user — download by guessing the reportId | 403 (not the requester) |
| requester whose grant was revoked after request — download | 403 (current-scope re-check) |
| CSV export of a student truly named `=Ravi` | cell stored as `'=Ravi` — never a live formula |
| aggregate over < 5 students in a report | withheld-cohort note in the document, no number |

## Consequences

- Reporting is additive and owns only `rpt_reports` (metadata; the artifact
  is in object storage). It reads through #5/#4 public surfaces exclusively —
  no new privileged path, no core change (ADR-0016 honoured).
- The withheld-cohort and out-of-scope states are visible IN the document, so
  a report never silently drops data — it says why a figure is absent.
- Any new report kind must route through `AnalyticsReadModel`, decide access
  via `canProduce`, and (for CSV) emit through `escapeCsvCell`. Adding a
  report that touches records directly, trusts the object key, or writes a
  raw CSV cell is a review-blocking regression.
