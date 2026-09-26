# School product and workflow review — 26 September 2026

Scope: local branch `codex/claude-school-product` at `a170f0c`, inspected without rebuilding the Docker demo. This is a source and prior-test-evidence review, not a claim of school-user acceptance or a fresh visual/browser evaluation. The separate [roadmap](CLAUDE-DELIVERY-ROADMAP.md) remains the delivery register.

## Benchmark boundary

Official public pages for [Alma](https://www.getalma.com/independent-and-charter/), [EdPlus](https://www.edpluss.com/) and [Vidyalaya](https://www.vidyalayaschoolsoftware.com/products-services/features) advertise connected student records, admissions, attendance, assessment, family access, fees and document workflows. Vidyalaya also advertises certificate templates. These pages establish advertised scope, not observed ease of use, implementation depth, internal licensing controls or school-user satisfaction. Vidya should use them to identify jobs to test, while keeping its own workflow and visual design.

## Current workflow assessment

| School job | Local evidence | What prevents a market-ready claim | Next acceptance test |
| --- | --- | --- | --- |
| Find and act on one pupil | Student 360 has profile, seven independently loaded tabs and history (`apps/web/app/(app)/students/[studentId]/page.tsx`). N6 records exits and corrections. | The record does not yet anchor an accepted-pupil admission flow or issued certificates. The return link says “Back to the register” but goes to `/dashboard`, so context is lost after opening from another desk. No current desktop/Android usability evidence exists for all seven tabs. | An office user finds a pupil from roster, fees and report-card desk, completes the same correction, and returns to the source without losing filters or context; test 390 px and desktop with keyboard. |
| Run attendance follow-up | Term threshold, calendar, effective enrollment windows, scoped review and PDF/Excel/CSV exports are implemented (N5). | Missing registers and confirmed shortfalls have no assigned, resolved in-app work queue. | Class teacher resolves an assigned case; administrator sees monthly unresolved cases without confusing missing data with absence. |
| Issue school documents | Immutable report-card PDFs and controlled school style versions exist. A certificate snapshot contract and English renderer exist. | A sample PDF/DOCX is a private reference, not mapped layout. Certificates have no live source-checked issuance, number allocation, approval, download or verification. | Issue one bonafide and one transfer certificate from verified source records; correct one with a new number; prove both records, current scope checks and minimal authenticity verification. |
| Collect fees and approve reports | Invoice/payment/adjustment records, report-card preview/publication and family reads exist. Payment writes have idempotency and audit controls. | Follow-up state, reconciliation, fee clearance policy, school-specific mapped report layout and a real school sign-off are open. | Whole-school CBSE fixture: office follows a due invoice through payment/receipt and checks a published report against the school-approved format. |
| Admit a pupil | Direct student creation, enrollment and CSV import exist in `people`; admission number is unique within a school. | No accepted-pupil admission workflow with the second owner-selected identifier, possible-duplicate review and guardian-invite handoff. Historical import is unproven at whole-school scale. | Accept one applicant, block a suspected duplicate, verify both identifiers, enroll, then invite a guardian only after acceptance. |
| Manage multiple school subscriptions | `control-plane` has a tenant registry, append-only subscription events, 30-day grace calculation, issuer-scoped operator binding and effective-access read model. `apps/operator/app/page.tsx` displays fictional tenants only in development. | No chosen/verifying OIDC adapter, authenticated live console, tenant provisioner, enforced read-only school mode, full export, billing, multi-tenant isolation or restore proof. | Named MFA operator views two real test tenants, changes one subscription with audit and reason, and proves the other tenant cannot be read or changed. |

## UI and management sequence

1. **Student 360:** preserve the pupil identity while changing tabs; restore the originating desk instead of sending every user to the dashboard; put the next permitted action beside the relevant record state; verify the seven-tab layout and focus at desktop and Android widths. Keep each panel's independent denial and error state.
2. **Office and finance desks:** connect pupil, invoice, attendance case, report-card and document actions with visible school/year context and a clear return path. Prove long tables, filters and touch targets with a realistic whole-school fixture.
3. **School policy page:** gather administrator-editable guardian history, certificate clearance and document-format policies with version/consequence text. Do not apply a new policy retroactively to issued records.
4. **Vendor console:** replace the fictional preview only after named-operator MFA and tenant isolation are proven. Keep vendor subscription records separate from pupil fee records.

The user-selected first pilot is a whole CBSE school with full-history import, and its first acceptance gate is fees and reports. This is a demanding data and usability gate. The local 40-pupil demo and current static review cannot establish that Vidya is easier to manage than the reference products. Conduct observed role-based school tasks, measure completion and error/recovery, then revise the workflow based on those findings.

## Order of the next bounded slices

1. Finish N7 source-checked, audited certificate issuance and number allocation before presenting a certificate action in Student 360.
2. Add N5 class-teacher in-app escalation queue and N8 fee follow-up; then connect these to the pupil record.
3. Build accepted-pupil direct admission with duplicate review and guardian handoff, followed by a measured full-history import rehearsal.
4. Complete controlled document layout mapping and Hindi option with real PDF visual proof.
5. Integrate the operator console only after OIDC selection, verified MFA, tenant isolation and read-only/export enforcement tests.

Each slice needs scoped API and database evidence plus desktop/phone browser use. A final comparison must be based on observed school tasks, not a count of advertised modules.
