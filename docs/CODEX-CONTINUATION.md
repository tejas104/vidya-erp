# Vidya ERP — Codex continuation

Updated 2026-09-14. This document supersedes the status figures and next-action
lists in `NEXT-SESSION.md` and the 2026-09-13 school plan; it does not replace
their architectural decisions.

## Project understanding

Vidya is an on-premise education ERP built as a TypeScript modular monolith:
Next.js/React web, a separate BullMQ worker, PostgreSQL, Redis and S3-compatible
storage. Sixteen module packages own their APIs and data. School and college
share one application image. The configured edition controls runtime module and
navigation registration, while migrations deliberately maintain one schema.

The established UI uses the shared `packages/ui-system` tokens, Inter, navy and
blue accents, responsive navigation, and light/dark themes. This continuation
preserves that layout and applies local accessibility and responsive fixes only.

## Implemented and stabilized

- School term management at `/manage/terms`: year filtering, creation, closure,
  reopening with a mandatory reason, and an administrator/principal read model.
- Configurable assessment types per term. Weights are whole percentages, names
  are unique, and a saved distribution must total 100 percent. Closed terms are
  protected in the handler and database.
- School assessments and marks: class/subject setup, teacher-scoped assessment
  creation, roster score entry through `ScoreEntryCard`, stored grading snapshots,
  mark history, and read-only behavior after term closure.
- Eleven authenticated school endpoints with shared `ScopeChecker` containment.
  Foreign-college, foreign-class and foreign-subject probes are covered by unit
  and PostgreSQL integration tests.
- A school-aware shell, sidebar and search index while retaining the college
  layout and behavior. Terms appear only for school installations; Marks selects
  the appropriate edition implementation.
- A System audit viewer with action filters, event limits, expandable details,
  refresh, empty, denied and error states.
- Tenant-scoped institution audit reads. Audit events can persist a trusted
  organization path; the API filters by the caller's colleges in SQL and checks
  every candidate again with the shared `ScopeChecker`. Unscoped/global events
  fail closed and remain available only to internal operational readers. See
  ADR-0025.
- Shared Input and Select accessibility fixes, disabled/invalid states, safer
  score submission, top-bar and licence-banner wrapping, and mobile overflow
  fixes for the school management screens in both themes.
- Redis password wiring for compose, install and worker/web configuration. The
  first compose update recreates Redis and invalidates active sessions; the
  install guide and deployment checklist now state this operational impact.
- Docker build contexts now include the school-academics workspace package. A CI
  guard discovers all workspace manifests and fails when either Dockerfile omits
  one.
- Route coverage now distinguishes active edition routes from excluded routes:
  active routes must answer with a non-404 response and excluded routes must 404.
  A missing composed handler also returns the documented JSON 404 instead of 500.
- The table-ownership guard now examines actual SQL table clauses and `pgTable`
  declarations instead of matching comments and identifier substrings. It still
  covers all sixteen modules and runs in CI.
- The stale licence blocker was corrected: the production public key exists.
  Clean-install verification is waiting only for an owner-issued, short-lived
  test licence; the signing key remains outside the repository.

The human-owned identity core and licence verifier were not changed. Existing
deployment/config edits present on arrival were preserved.

## Verification evidence

| Check | Result |
| --- | --- |
| Workspace typecheck | exit 0 |
| Unit suite | 835 passed / 84 files |
| UI suite | 284 passed / 65 files |
| Integration suite | 92 passed / 17 files |
| Focused school integration | 10 passed / 2 files |
| College production browser suite | 77 passed; 151 active routes, 0 unexpected 404s |
| School production browser suite | 5 passed; 162 active routes, marks/terms and mobile themes |
| Lint and design-token checks | pass |
| OpenAPI drift check | pass |
| Table ownership guard | 16 modules pass |
| Docker workspace-manifest guard | 20 packages pass |
| Production builds | college and school pass |
| Clean Docker image builds | web and worker pass |
| Migration status from new worker image | 33 applied, 0 pending |

The school browser run uses the disposable `vidya_codex_school` database. The
college browser run uses the existing demo seed because its shared role journeys
depend on those fixtures. School terms, marks, mobile rendering and the complete
school route inventory are verified separately so fixture differences cannot
produce a false edition failure.

Mutation checks were also observed red and then restored: removing school term
containment failed two tests, removing assessment-type containment failed two,
disabling marks containment failed the class/subject probes, and removing the
audit response recheck failed the foreign-college case.

## Remaining school and ERP work

The stabilization scope is complete. The next school product increments remain:

1. Weighted aggregate results across assessment types and attendance summaries
   for a term.
2. Reporting-owned report-card snapshots, branding/signatures, individual PDFs,
   batch progress and merged print output.
3. Multiple guardians with a primary contact, section contact exports and agreed
   school compliance fields.
4. Promotion preview and atomic commit, per-student exceptions, leaver states and
   transfer certificates. Student history must remain immutable.
5. School-specific help content and a clean-server install/update/rollback proof
   after the owner provides college and school test licence tokens.

After the academic lifecycle is complete, the useful market-readiness order is
finance approvals and reconciliation, admissions workflow, staff attendance and
payroll, inventory/procurement, library/transport/hostel, then operational alerts
and restore drills. These items are a backlog and are not claimed as shipped.

## Local runtime notes

PostgreSQL for this workstation is exposed on port 55432. Integration tests use
disposable databases rather than the college demo database. The currently
running Redis container does not require a password even though the updated
compose configuration does; applying that configuration will recreate Redis and
sign users out. No deployment was performed in this continuation.
