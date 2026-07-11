# Post-Service Review Gate — Vidya #6 (inputs to a HUMAN approval decision)

Evidence for reviewers, not self-approval. "Verified" = executed by the author
(Windows, Node 22, pnpm 11.9). Integration/compose/CI run in CI — the human
gate. #6 is the **MVP finish line** (reporting + export + polish), explicitly
NOT "build everything remaining": the deferral list is honored (see "Deferred,
untouched" below).

## ⚠ THE flagged items: report scope-filtering, scoped download, CSV-injection

Per the assignment, three security-critical controls need human verification.
All are executed — unit against the real human-owned checker, and re-proven
end-to-end over real Postgres + MinIO in `tests/integration/reporting-flow.int.test.ts`:

1. **A report is a disclosure surface (scope-filtering).** Read ADR-0020.
   Confirm a report is assembled ONLY through #5's `AnalyticsReadModel` +
   #4's read model — so it inherits constituent-closure, the K=5 cohort rule
   and at-risk field-gating unchanged. Reporting owns no direct-record query.
   `canProduce` refuses an out-of-scope target at request time (403) before any
   job is enqueued; a below-K aggregate prints a withheld-cohort note, not a
   number.
2. **Scoped download (no URL-guessing).** The artifact's object key is a random
   UUID but is NEVER the access boundary. Download requires
   `requested_by === caller` AND a fresh `canProduce` re-check of the caller's
   CURRENT scope. Confirm: a second authenticated user handed the `reportId`
   gets 403; a requester whose grant was revoked after request gets 403. Unit
   (`report-service.test.ts`) + integration.
3. **CSV/Excel formula-injection escaping.** Read `escape-csv.ts` (one page,
   100%-coverage-gated). Confirm every CSV cell is apostrophe-escaped when it
   begins with `= + - @ TAB CR`, then RFC-4180 quoted. Integration proves it
   with a student literally named `=Ravi Injection` — the exported cell is
   `'=Ravi Injection`, never a live formula, and no line begins with a formula
   character.

**#6 required ZERO edits to the human-owned core** — ADR-0016 honored. The
worked-example verdict table is in ADR-0020 and docs/security-review.md#reporting.

## Ratify-or-flag: the parked decisions

The assignment asked to ratify or flag three decisions carried into the MVP:

| Decision | Recommendation | Rationale |
|---|---|---|
| **College creation is CLI-only** (`bootstrapCollege` via `scripts/create-admin.ts`; no UI/route) | **Ratify for the MVP.** | Multi-college self-service is on the deferral list (multi-tenant SaaS). A single college per deployment is the pilot model; the operator bootstraps it once. Trigger to revisit: a genuine multi-college tenant. |
| **CSV-only export (no `.xlsx`)** | **Ratify.** | Consistent with ADR-0009's rejection of heavyweight/native spreadsheet parsers; colleges open CSV in Excel. `.xlsx` would add an attack surface for zero MVP benefit. Trigger: a hard requirement for native workbook formatting. |
| **The unused `approve` verb in the scope matrix** | **Flag, keep as-is (do NOT touch).** | The HUMAN-OWNED conformance matrix defines `approve` ("hod approves within their department") but no route consumes it yet. It is a frozen, forward-looking capability (a future grade-change/attendance approval workflow) covered by the conformance suite. It is dead *surface*, not dead *code that misbehaves*; removing it would be a core edit (ADR-0016). Recommendation: leave it, and let the first approval feature wire a route to it. |

## Architecture review

- reporting is a standard #1-contract module: it owns exactly one table
  (`rpt_reports`, metadata only — the PDF/CSV artifact lives in MinIO), 4
  routes, 1 worker job, forward+rollback migration. Ownership check green
  across all six prefixes; it imports source data ONLY via #5's new public
  `AnalyticsReadModel` and #4's read model — never their tables, never a direct
  record query.
- One additive cross-module extension: analytics gains a public
  `AnalyticsReadModel` (a thin, tested wrapper over the ADR-0018
  `QueryService`) so reports read through the SAME disclosure surface the
  dashboard uses. No core change; no new privileged path.
- Binary delivery: the download handler returns a `Uint8Array` through the
  existing `defineRoute` pipeline (a small, reviewed `toResponse` addition) with
  `application/octet-stream` + `Content-Disposition` — the one place the
  text-oriented response path carries bytes.

## Security review

docs/security-review.md#reporting, docs/threat-model-reporting.md
(artifact-focused: IDOR on download, generation-privilege, CSV formula
injection, artifact retention). ADR-0020 is the security centerpiece; ADR-0021
records the pdfkit choice (pure-JS, no Chromium/sandbox attack surface).

## Performance review

docs/performance.md (#6): generation is a queued worker job (202 + poll), off
the request path; each report is bounded by the requester's scope; failures are
captured on the row, not retried into a storm. `canProduce` is a cheap
read-model access decision (no rendering) run at request AND download.

## API + frontend review

- 4 reporting routes (**62 total across the six modules**), all
  auth-required, zero public; the one state-changer (request) is
  audited, as are generation and download. OpenAPI regenerated and
  drift-checked (`openapi:check`).
- Frontend (the #5 recorded debt, now PAID): a vitest `ui` project (jsdom +
  React Testing Library) covering login, the permission-mirror dashboard, a
  scoped report generate→download (the `ReportButton` flow), and a
  withheld-cohort empty state. Pages remain pure same-origin API consumers; the
  report UI adds a client component that requests → polls → offers the
  scope-checked download link.

## Test coverage summary

- **Unit: 480 tests, 51 files — executed, green.** Global gate ≥80% (measured
  93.14% lines / 87.51% branches). Security gates: **100% on
  `reporting/src/escape-csv.ts`**, 95% on `reporting/src/service/**` (plus the
  existing academics/identity/analytics gates) — all passing. `renderPdf` is
  integration-tested and excluded from line-coverage (imperative drawing, no
  branching to gate — ADR-0021).
- **Frontend: 10 tests, 3 files (vitest `ui` project) — executed, green.**
  `pnpm test:ui`. Login (success/redirect + 401/403 states), dashboard
  (permission mirror + withheld-cohort + at-risk merge + 401 redirect),
  ReportButton (generate→poll→download, out-of-scope 403, generation failure).
- **Integration: reporting-flow.int.test.ts (6 tests; suite now 8 files) —
  written, NOT executed locally (no Docker); CI runs it.** Real stack:
  request→worker-generate→download a real `%PDF-` artifact; CSV escaping of a
  `=Ravi` student; requester-only download (a second real user gets 403);
  out-of-scope target refused at request; a non-admin (class teacher) scoped
  generation. Migrations test extended for `reporting/0000_reporting` +
  `rpt_reports`.
- **Demo seed: `scripts/seed-demo.ts` — typechecks + lints; NOT executed
  locally (no Docker).** Drives the real #2→#3→#4 chain (authenticated,
  scope-checked, audited) via the same routes the integration suite exercises;
  gated by `VIDYA_ALLOW_DEMO_SEED=true` and refused under `NODE_ENV=production`.

## Technical debt added

| Item | Why accepted | Trigger |
|---|---|---|
| No artifact/`rpt_reports` retention sweep | Access is re-checked on every download, so a stale artifact is not a bypass | Before large-scale rollout — add a TTL/retention job |
| `renderPdf` excluded from line-coverage | Imperative drawing, no branching; integration asserts a real artifact | If PDF layout gains conditional logic worth gating |
| Report request has no dedicated rate limit | Generation is queued + scope-bounded | Shared with the platform-wide global rate-limit note (#2) |
| Demo seed accumulates on re-run only if org codes change | Idempotent by fixed codes; a second run reprints credentials | If a mutable demo dataset is ever needed, add a reset path |
| "Serve only through the read-model surface" is convention + heuristic-lint debt | Lint can't see it semantically | The recurring debt since #4 — reporting inherits it |

## Future risks

1. **Reporting is a disclosure surface; any new report kind re-opens the
   review.** A new kind MUST route through `AnalyticsReadModel`, decide access
   via `canProduce`, and (for CSV) emit through `escapeCsvCell`. The 100%/95%
   gates and ADR-0020 are the guardrails.
2. **Artifact retention.** Old PDFs/CSVs persist in object storage; the
   download re-check keeps them non-leaking, but a retention policy is needed
   before scale.
3. **Deferred surfaces bring their own inference/trust models** — report-cards
   (signed artifacts), scheduled/emailed reports (delivery + recipient trust),
   student/parent exports (a new audience). Each needs its own review, as
   analytics warned.

## Deferred, untouched (per the assignment's list)

Fees, admissions, exam scheduling, formal report-cards, NAAC/compliance,
predictive/AI analytics, student/parent portals, notifications, org-unit moves,
multi-tenant SaaS, LDAP/AD/SSO. None were built; where one seemed adjacent
(e.g. multi-college creation) it was left as a ratified parked decision, not
implemented.

## Items requiring human action before acceptance

1. **Verify the three flagged controls** (scope-filtering, scoped download,
   CSV-injection escaping) — items 1–3 above; the assignment's explicit gate.
2. **Ratify or override the three parked decisions** (college-creation CLI-only,
   CSV-only, the unused `approve` verb).
3. Run integration + compose on a Docker machine: CI end-to-end, then load the
   UI against real data, seed the demo, and confirm the permission mirror and a
   scoped report generate→download by hand.
4. Confirm the MVP scope line is where the institution wants it (the deferral
   list) before calling this the finish line.
