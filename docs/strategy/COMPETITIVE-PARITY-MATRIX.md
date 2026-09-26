# Vidya competitive parity matrix (clean-room)

Owner: Vidya product architecture. First written 2026-09-23 against integration
commit `0ddf80cc3ab8ff1ecc1b663fd0e6d152badeb161`.

## How to read this document

This is a **clean-room competitive record**. It exists so Vidya can learn
information architecture, workflow expectations and usability lessons from three
benchmark products without copying them.

Every row separates three different kinds of statement, and they must never be
collapsed into each other:

| Label | Meaning |
|---|---|
| **[PUBLIC]** | Verbatim-sourced capability name from a public marketing page, with URL and access date. It proves the vendor *advertises* the capability. It does **not** prove depth, quality, or that the workflow is good. |
| **[INFERENCE]** | Our reading of what that capability probably implies operationally. Unverified. Must be revalidated before it drives a release decision. |
| **[VIDYA]** | Our own decision and current state, verified against this repository's routes, modules and tests — not against marketing. |

### Clean-room rules in force

- No proprietary code, private API, protected copy, trademark, logo,
  illustration or brand asset from any reference vendor enters this repository.
- Capability *names* are recorded as evidence of market expectation. Product
  *copy* is not reproduced.
- Vidya workflows are expressed through Vidya's existing design system and
  domain language. No pixel-for-pixel cloning.
- A marketing checkbox is **not** a validated requirement. Rows stay
  `Unvalidated` until a real school administrator, teacher, accountant or
  parent has confirmed the job to be done.

### Sources

| ID | Source | URL | Accessed |
|---|---|---|---|
| A1 | Alma — Solutions / feature taxonomy | https://www.getalma.com/solutions/ | 2026-09-25 |
| A2 | Alma — What is a Student Information System | https://www.getalma.com/what-is-a-student-information-system-sis/ | 2026-09-23 |
| E1 | EdPlus AI — product home / ERP modules | https://www.edpluss.com/ | 2026-09-25 |
| V1 | Vidyalaya School ERP — school ERP overview | https://www.vidyalayaschoolsoftware.com/products-services/school-erp | 2026-09-25 |
| V2 | Vidyalaya School ERP — student and parent portal | https://www.vidyalayaschoolsoftware.com/products-services/integration/online-portal | 2026-09-25 |

The vendors are benchmarks for *different* things, and conflating them is a
product error:

- **Alma [A2, PUBLIC]** explicitly positions the SIS as the K-12 *system of
  record* — demographics, enrollment, attendance, grades, transcripts, state
  reporting — and explicitly distinguishes it from an LMS (instruction) and from
  a school ERP (business operations). Alma is therefore the benchmark for
  **record correctness, configurability and educator-centred clarity**.
- **EdPlus [E1, PUBLIC]** positions as an India-market all-in-one institutional
  ERP with broad operational modules, a white-label mobile app, and a
  "30-minute installation guarantee" with Excel-led data setup. EdPlus is
  therefore the benchmark for **operational breadth, onboarding speed and
  parent-facing mobile reach** in the Indian market.
- **Vidyalaya [V1/V2, PUBLIC]** advertises admissions, attendance, fees,
  assessment, certificates, mobile access and a parent/student portal. It is
  an additional India-market reference for **joining daily school operations
  to a family-facing record**. The pages establish advertised scope only;
  no workflow depth, correctness or user satisfaction has been verified.

Vidya's intended position is a **school-first Indian cloud SaaS with SIS-grade
record and financial correctness**. The product goal joins clear educator
workflows, India-market operational breadth, server-enforced tenant isolation
and auditable financial records. These are Vidya design goals, not verified
comparative claims about the reference vendors.

### Vidya current-state legend

- **Complete** — shipped, authorized server-side, tested, reachable in the UI.
- **Partial** — exists but with a named gap (engine without wiring, backend
  without UI, UI without backend, or no authorization).
- **Missing** — not present.
- **Deferred** — deliberately not built yet, with the reason recorded.

The 2026-09-24 N1 inventory contains 178 RouteSpecs and 16 owned table prefixes
(`sys_ idn_ ppl_ acd_ anl_ rpt_ ptl_ ttb_ cwk_ syl_ fee_ ntc_ res_ exm_ lvs_
sca_`). Feature states below must be rechecked against code before release;
they are not established by a plan document.

### Current comparison checkpoint — 2026-09-25

The detailed priority rows below were written at earlier checkpoints. Their
historical `Vidya current state` text must not be used as today's status where
it conflicts with this table. Public vendor pages show advertised scope only;
they do not establish depth, usability, security or customer acceptance.

| School job | Public benchmark signal | Vidya state verified in this branch | Next completion gate |
|---|---|---|---|
| One pupil record | Alma [A1] advertises student data and enrollment history. | **Partial.** Student 360 at `/students/[studentId]` has profile, history and independently scoped panels. A year-end promotion, detention and exit batch (N6) records outcomes; an audited one-pupil correction retains the original history. Admissions is still absent. | A connected admissions handoff and real-school validation. |
| Attendance and oversight | Alma [A1] advertises attendance reports; Vidyalaya [V1] advertises attendance management. | **Partial.** Class and teacher registers, scoped reporting exports and monthly Analytics views exist. The school review uses explicit instructional days and effective enrollment windows, and separates unsubmitted daily registers, missing pupil entries, unverified dates and confirmed shortfall. Escalation and school pilot acceptance remain open. | Complete N5 escalation and pilot validation. |
| Marks and report cards | Alma [A1] advertises grading and report cards; Vidyalaya [V1] advertises assessment and progress cards. | **Partial.** Weighted school marks, immutable report-card snapshots, PDFs and audited parent publication exist. Teacher CSV marks import now previews changed scores and row errors, then uses an audited atomic save with a stale-score guard. | Measure pilot-sized imports and complete N4 review; continue N5–N7. |
| Family access | Alma [A1] advertises parent portals; Vidyalaya [V2] advertises parent/student records. | **Partial.** `/family` includes relationship-gated attendance, marks, notices, fees and published report cards. Provider delivery and school-user acceptance are absent. | Parent delivery adapter and two-child revocation/user acceptance. |
| Fees and recovery | Alma [A1], EdPlus [E1] and Vidyalaya [V1] advertise fees. | **Partial.** Vidya has invoice/payment/adjustment records and family fee reads. Follow-up state, concessions, installments and reconciliation are not complete. | N8 and Phase 2 finance workflows with audit and restore proof. |
| Fast data onboarding | Alma [A1] advertises validated bulk uploads; EdPlus [E1] advertises Excel-led setup. | **Partial.** Student and staff CSV imports and a teacher marks CSV flow exist. Guided school setup and measured large-cohort onboarding do not. | N4 scaling proof plus guided school setup with a pilot-sized synthetic school. |
| Wider school operations | EdPlus [E1] and Vidyalaya [V1] advertise transport, HR, certificates and other modules. | **Missing/deferred.** Staff attendance exists; payroll, transport and library are not built. Certificates depend on a recorded exit. | N6/N7 first; choose further modules from pilot demand. |
| Repeatable hosted SaaS | This is Vidya's delivery requirement, not a vendor parity claim. | **Design only.** ADR-0030 defines the control-plane boundary; this checkout has no deployed tenant provisioning or hosted licence/subscription service. | Phase 3 implementation and two-tenant isolation, restore and entitlement proof. |

The ordered work remains in [CLAUDE-DELIVERY-ROADMAP.md](CLAUDE-DELIVERY-ROADMAP.md).
No row is validated by a real school user yet. Current demo data and browser
checks prove only the named local flows.

### Vidyalaya reference — candidate jobs, not release claims

| Public signal | Vidya decision | Validation |
|---|---|---|
| **[PUBLIC, V1]** Admission and student management appear together in the advertised module set. | **[VIDYA]** Keep the admissions-to-student handoff in Phase 2; preserve a single pupil record in N1. | Unvalidated with school staff. |
| **[PUBLIC, V1]** Attendance, fees, assessment, progress cards and certificates are advertised. | **[VIDYA]** Continue N3 and N5–N8 with auditable source records; do not infer the vendor's calculations or controls. | Unvalidated with school staff. |
| **[PUBLIC, V2]** The portal advertises child attendance, results and fees in one signed-in surface. | **[VIDYA]** N3 expands the existing relationship-scoped family portal. Each category remains separately authorized for each child. | Unvalidated with parents. |

---

## Priority 1 — Daily high-frequency school work

### 1.1 Daily attendance capture

- **Actor / JTBD** — A class teacher must mark a full class present/absent in
  under a minute, from a phone or a shared desktop, before the first period
  ends.
- **Alma [A1, PUBLIC]** — "Positive & negative attendance", "Attendance
  reporting", "Attendance notifications", "Truancy reports", "Seating charts".
- **EdPlus [E1, PUBLIC]** — "Attendance" module; "Attendance sync" on the mobile
  app; attendance surfaced to parents.
- **[INFERENCE]** — Positive/negative attendance implies a configurable default:
  mark only exceptions (negative) for large classes, mark everyone (positive)
  where a funding or compliance rule demands a per-student affirmative record.
  Unverified which Indian schools require which.
- **Vidya current state** — **Complete (session capture)**. 6 attendance routes
  under `/api/v1/academics/attendance/*` plus
  `/api/v1/academics/sections/{sectionId}/roster-attendance`. Subject-teacher
  attendance shipped. Scope model fixed by ADR-0017.
- **India/Maharashtra requirement** — Attendance shortfall drives exam
  eligibility in many boards; the shortfall calculation must be defensible and
  explainable to a parent, not a black box.
- **Proposed Vidya workflow / why better** — Keep one-tap roster marking, then
  add an explicit **shortfall workflow** that shows the *denominator* — which
  days were instructional, which were excused, which are simply unrecorded.
  S02's engine already separates "pupil absent" from "teacher never submitted",
  which is the single most common source of parent disputes and which a simple
  percentage hides.
- **Owning module / data authority** — `academics` (`acd_`). Calendar authority
  is currently implicit and must become explicit.
- **Security/privacy** — Standard. Scope-checked per section.
- **Surfaces** — Web (done), parent app (pending), college app (later).
- **Dependencies** — Explicit school calendar authority; S02 engine wiring.
- **Acceptance** — A principal can see, for one student, expected vs recorded vs
  missing days with the missing dates named.
- **Phase** — 1.
- **Validation** — Unvalidated.

### 1.2 Marks entry and term grading

- **Actor / JTBD** — A subject teacher enters marks for an assessment once, and
  trusts that the term total is computed identically for every student.
- **Alma [A1, PUBLIC]** — "Human-readable gradebook", "Human-readable grade
  calculations", "Calculated class grades", "Assignment management", "Missing
  assignments"; separately a full "Competency grading" family with
  "Configurable competencies", "Configurable rubrics", "Roll-up class grade
  calculations", "GPA equivalencies for college".
- **EdPlus [E1, PUBLIC]** — "Exam Management", "Academics & Results", results
  pushed to the student/parent app.
- **[INFERENCE]** — Alma's repeated use of "human-readable" for *calculations*
  (not just the gradebook) suggests a deliberate product stance that a teacher
  must be able to explain a computed grade to a parent without support. We read
  this as the single most transferable usability lesson from Alma.
- **Vidya current state** — **Partial**. School marks entry exists
  (`/api/v1/school/assessments/{assessmentId}/marks`, `sca_`) and term
  assessment types with weights exist. The S01 weighted-result engine is
  **written and tested but not exported from the module's public API and not
  wired to any route** (`packages/modules/school-academics/src/aggregation/`,
  `service: {}` in the module's index).
- **India requirement** — CBSE/State board term structures with weighted
  internal + term assessment components; grade bands vary per board and per
  school.
- **Proposed Vidya workflow / why better** — Adopt Alma's "explainable
  calculation" stance and go further: S01 already returns a per-assessment-type
  `TypeContribution` breakdown *and* documents an explicit rounding contract
  (`finalPercentage` is rounded once from exact rationals, never from summing
  rounded parts). Surface that breakdown in the UI so a disputed mark can be
  reconciled on screen. Most competitors show only the final number.
- **Owning module / data authority** — `school-academics` (`sca_`) owns marks
  and the calculation. `results` (`res_`) owns grade scales.
- **Security/privacy** — Standard, scope-checked; term closure locks marks.
- **Surfaces** — Web (done), parent app (read-only results), college app.
- **Dependencies** — Export S01 through the module public API (this slice).
- **Acceptance** — Two independent calls with identical inputs return an
  identical `finalPercentage`, and the breakdown explains it.
- **Phase** — 1.
- **Validation** — Unvalidated.

### 1.3 Homework / coursework

- **Actor / JTBD** — A teacher posts homework once; parents see it the same
  evening without a WhatsApp forward.
- **Alma [A1, PUBLIC]** — "Assignment management", "Missing assignments".
- **EdPlus [E1, PUBLIC]** — "Homework & Notes" as a named top-level module.
- **Vidya current state** — **Complete (staff side)**. 11 coursework routes
  including submissions, evaluation, materials and `my/*` student views (`cwk_`).
- **Proposed Vidya workflow** — Reuse the existing coursework module for the
  parent surface rather than building a second homework store.
- **Owning module** — `coursework` (`cwk_`).
- **Phase** — 1 (parent surface).
- **Validation** — Unvalidated.

### 1.4 Timetable and substitutions

- **Alma [A1, PUBLIC]** — "Advanced scheduling", "Walk-in scheduling", "Course &
  class management", "Course requests", "Graduation tracking".
- **EdPlus [E1, PUBLIC]** — "Timetable" module.
- **Vidya current state** — **Partial**. 6 timetable routes including
  `sections/{sectionId}/grid` and `my/today`, `my/week` (`ttb_`).
  **Substitutions are Missing** — no route exists.
- **[INFERENCE]** — Alma's "walk-in scheduling" implies same-day schedule
  changes are a first-class flow, not an admin edit. For an Indian school the
  equivalent daily pain is *teacher absence substitution*, not student
  course-change.
- **Proposed Vidya workflow / why better** — Build **substitution** as the
  India-shaped analogue: when a teacher is marked on leave, the timetable
  surfaces the affected periods and proposes free teachers. This links `lvs_`
  (leave, already built) to `ttb_` — a connection neither benchmark advertises.
- **Owning module** — `timetable` (`ttb_`), reading `leave` via a contract.
- **Phase** — 2.
- **Validation** — Unvalidated.

---

## Priority 2 — Financial and academic correctness

### 2.1 Report cards and transcripts

- **Actor / JTBD** — An examination in-charge generates a term report card that
  is **permanent** — reprinting it a year later must produce byte-identical
  academic content even if marks were later corrected.
- **Alma [A1, PUBLIC]** — "Report cards", "Transcripts", "Enrollment history",
  "Flexible GPA calcs", "Imported historical grades"; separately
  "Standards-based report cards" and "Progress reports".
- **EdPlus [E1, PUBLIC]** — Results via app; "Certificates" as a separate module.
- **[INFERENCE]** — Neither vendor publicly commits to report-card
  **immutability**. This is a correctness gap we can own as differentiation
  rather than a parity item. Unverified whether either stores snapshots.
- **Vidya current state** — **Partial — frontend only**.
  `SchoolReportCardsPage` and `/manage/report-cards` exist and pin a four-route
  API contract. **None of those four routes exist** in the 141-route spec. This
  is the active slice.
- **India requirement** — A report card is a document a family keeps for years
  and a school may be asked to reissue; it must not silently change.
- **Proposed Vidya workflow / why better** — Reporting-owned **immutable
  snapshots**: generation computes via S01 + S02 through module public APIs,
  persists the computed result, and the PDF renders *from the stored snapshot*,
  never by recomputation. Missing data stays explicitly missing and is never
  coerced to zero. This is stronger than an advertised "report cards" checkbox.
- **Owning module / data authority** — `reporting` (`rpt_`) owns the snapshot.
  It must **not** query `sca_` or `acd_` tables directly.
- **Security/privacy** — High. Roster, preview, generate and download each
  authorize independently; download is scope-checked, never URL-secret
  (ADR-0020).
- **Surfaces** — Web now; parent download later.
- **Dependencies** — S01 and S02 exported through module public APIs.
- **Acceptance** — Regenerating after a mark change produces a *new* snapshot;
  the old snapshot's PDF is unchanged.
- **Phase** — 1. **This is the current slice.**
- **Validation** — Unvalidated.

### 2.2 Fee management and financial correctness

- **Alma [A1, PUBLIC]** — "Any type of fees", "Credit card payment collection",
  "ACH payment collection", "Cash payment tracking", "Parent portal access".
- **EdPlus [E1, PUBLIC]** — "Student Fees", "Income / Expenses", "Finance
  Recovery" as three distinct modules.
- **[INFERENCE]** — EdPlus separating "Finance Recovery" from "Student Fees"
  implies defaulter chasing is a distinct staffed workflow in Indian schools,
  not a report. Plausible and consistent with Indian practice; unverified.
- **Vidya current state** — **Complete (core), strongest area**. 13 fee routes
  including `generate`, `payments`, `adjustments`, `collections/summary`,
  `defaulters` (`fee_`). Hardened by S04/S05: refund eligibility bounded under
  the invoice lock, numeric-overflow bounds, idempotent payment retries with a
  partial unique index, and **transactional audit** (ADR-0026) so an audit row
  cannot be lost after a financial commit.
- **India requirement** — Installments, concessions, fines, cheque settlement
  state and printable defaulter notices; strict separation from vendor
  subscription billing.
- **Proposed Vidya workflow / why better** — Vidya's audited, idempotent,
  transactionally-consistent ledger is a genuine correctness advantage over a
  "fees" checkbox. Keep the ERP subscription ledger **physically separate** from
  the school fee ledger — a boundary neither benchmark needs to make because
  neither is sold as a multi-tenant ERP to the same buyer.
- **Owning module** — `fees` (`fee_`).
- **Security/privacy** — High. Money-moving routes are idempotent and audited.
- **Phase** — Core complete; depth (concessions, reconciliation, gateways) in 2.
- **Validation** — Partially validated by the S04 correctness audit; **not**
  validated with a school accountant.

### 2.3 Data administration and bulk correction

- **Alma [A1, PUBLIC]** — "Spreadsheet data editing tools", "Bulk uploads with
  validation", "Bulk editing", "Mailing labels", "Robust reporting".
- **EdPlus [E1, PUBLIC]** — "In-built Excel Integrated To Data Setup";
  "30-Minute Installation Guarantee".
- **[INFERENCE]** — Both vendors treat spreadsheet-shaped bulk editing as a
  first-class product surface, not an import afterthought. Strong signal.
- **Vidya current state** — **Partial**. People import exists with an errors
  endpoint and a downloadable template (`/api/v1/people/imports*`), which is the
  right shape. **Bulk marks import is Missing.** Bulk editing is Missing.
- **Proposed Vidya workflow / why better** — Keep the existing dry-run +
  downloadable error report pattern and extend it to marks. Vidya's exports are
  already formula-injection-escaped in shared platform code — a correctness
  detail neither vendor advertises and which matters the moment a school opens
  an export in Excel.
- **Owning module** — `people` (`ppl_`) for people; `school-academics` (`sca_`)
  for marks.
- **Phase** — 1 (bulk marks import), 2 (broader bulk editing).
- **Validation** — Unvalidated.

---

## Priority 3 — Parent trust and communication

### 3.1 Guardian identity and authorization

- **Actor / JTBD** — A parent signs in and sees **their own children only** —
  including the case of two guardians of one child, one guardian of children in
  different classes, and a guardian whose access must be revoked after a custody
  change.
- **Alma [A1, PUBLIC]** — "Household contacts", "Emergency contacts", "Parent &
  student portals", "Custom roles & permissions".
- **EdPlus [E1, PUBLIC]** — App with "Student / Parent" as one of three roles.
- **[INFERENCE]** — EdPlus collapsing "Student / Parent" into a single app role
  suggests phone-number-keyed access. For Vidya that is an **anti-pattern**: a
  phone number is a contact channel, not an identity, and it breaks on shared
  numbers, changed numbers and custody changes.
- **Vidya current state** — **Missing (by design, correctly)**. An S03 guardian
  authorization specification exists at PROPOSED status with tests that validate
  invariants but never invoke an authorization adapter. The gate-04 review
  explicitly confirms no production grants or route wiring exist, and records
  that guardian authentication shape, relationship revocation semantics, policy
  defaults and the identity boundary **need an ADR before implementation**.
- **India requirement** — Shared family phones are common; custody and
  guardianship changes are real and legally sensitive.
- **Proposed Vidya workflow / why better** — Explicit `guardian → student`
  relationship rows with their own lifecycle (granted, active, revoked) as the
  authorization source, resolved server-side on every read. Phone numbers remain
  contact channels only. This is deliberately stricter than the benchmark.
- **Owning module** — `people` (`ppl_`) owns the relationship; `identity`
  (`idn_`) owns the credential. The boundary between them is the ADR's subject.
- **Security/privacy** — **Highest.** This is the single largest open security
  design question in the product.
- **Dependencies** — ADR required **before** implementation. Blocks all parent
  surfaces.
- **Phase** — 1 (ADR + implementation).
- **Validation** — Unvalidated. **Must** be validated with real school office
  staff on custody/revocation before the policy defaults are fixed.

### 3.2 Parent portal essentials

- **Alma [A1, PUBLIC]** — "Parent & student portals", "Mobile interface",
  "Student, staff, household messaging", "Group messaging",
  "Teacher-to-student messaging", "Text alerts".
- **EdPlus [E1, PUBLIC]** — "White Label App", iOS + Android, "Notifications",
  "Calling System".
- **Vidya current state** — **Partial**. A `portal` module exists (`ptl_`) with
  5 routes (`me`, `attendance`, `timetable`, `today`, `marks`) — but it is a
  **student** portal, and it is gated by student identity, not guardian
  identity.
- **Proposed Vidya workflow** — Reuse the `portal` read models behind a guardian
  authorization resolver rather than writing a parallel parent module. Notices,
  homework, attendance, results, timetable, fee ledger and receipts.
- **Owning module** — `portal` (`ptl_`).
- **Dependencies** — 3.1 (guardian ADR) is a hard blocker.
- **Phase** — 1.
- **Validation** — Unvalidated.

### 3.3 Communication, consent and delivery logs

- **Alma [A1, PUBLIC]** — messaging family above, plus "Notifications & alerts".
- **EdPlus [E1, PUBLIC]** — "Notifications", "Calling System", "Task Management".
- **[INFERENCE]** — Neither vendor publicly advertises **consent/opt-out** or
  **delivery logs** as features. For India (TRAI/DLT registration for SMS,
  WhatsApp Business policy) these are operational necessities, not niceties.
  Unverified how either handles it.
- **Vidya current state** — **Partial**. `notices` module (`ntc_`) with 3 routes
  and an audience-visibility model (ADR-0022 containment vs audience matching).
  External SMS/WhatsApp/email adapters are **Missing**.
- **Proposed Vidya workflow / why better** — Treat every external provider as an
  adapter with retries, rate limits, cost controls, delivery logs and a real
  opt-out. Make consent state a first-class field. This is a compliance
  advantage in the Indian market, not just a feature.
- **Owning module** — `notices` (`ntc_`).
- **Phase** — 2.
- **Validation** — Unvalidated.

---

## Priority 4 — Onboarding, migration and supportability

### 4.1 Rapid onboarding and Excel migration

- **EdPlus [E1, PUBLIC]** — "30-Minute Installation Guarantee", "Hand Holding
  Support", "In-built Excel Integrated To Data Setup", "We Follow a Structured
  Process to Complete Setup Tasks with Your Team".
- **Alma [A1, PUBLIC]** — "Onboarding: Navigator", "In-app help docs", "Bootcamp
  video library", "Study guide library", "In-app support for all staff",
  "Bulk uploads with validation".
- **[INFERENCE]** — This is where EdPlus most likely wins Indian deals. A
  30-minute claim is a *sales* promise about assisted setup, almost certainly
  not unattended self-service — but it sets the buyer's expectation, and Vidya
  will be compared against it regardless of its literal truth.
- **Vidya current state** — **Partial**. People import with dry-run validation,
  an errors endpoint and a template download is the right foundation. School
  onboarding as a guided end-to-end flow is **Missing**.
- **Proposed Vidya workflow / why better** — A guided onboarding that is honest
  about time and **never silently partially imports**: dry-run, downloadable
  per-row error report, then an atomic commit. A school that trusts the import
  is worth more than a school that was promised 30 minutes.
- **Owning module** — `people` (`ppl_`), plus a thin onboarding orchestration.
- **Phase** — 2.
- **Validation** — Unvalidated.

### 4.2 In-product help and supportability

- **Alma [A1, PUBLIC]** — in-app help docs, bootcamp videos, study guides,
  in-app support for all staff.
- **Vidya current state** — **Partial, and ahead of expectation in shape**.
  Edition-aware compiled help exists (`content/help/school/*`, help buttons
  wired into pages, `help-content.generated.ts`). Coverage is thin: the build
  reports 26 school screens with no help doc and 16 college screens with none.
- **Proposed Vidya workflow** — Keep edition-aware help; close coverage screen
  by screen as each slice ships. Help content is part of the Definition of Done,
  not a later pass.
- **Owning module** — web + `content/help`.
- **Phase** — Continuous.
- **Validation** — N/A.

---

## Priority 5 — Compliance and documents

### 5.1 Certificates, ID cards and school documents

- **Alma [A1, PUBLIC]** — "Virtual file cabinet", "Secure document upload",
  "Mailing labels".
- **EdPlus [E1, PUBLIC]** — "Certificates", "ID Card", "Website" as named
  modules.
- **[INFERENCE]** — Indian schools issue bonafide certificates, transfer
  certificates (TC) and character certificates routinely; a TC in particular is
  a legally significant exit document tied to enrollment status.
- **Vidya current state** — **Missing**. Student documents exist
  (`/api/v1/people/students/{studentId}/documents` with authorized download),
  which is the storage foundation — but no certificate generation.
- **Proposed Vidya workflow / why better** — Certificates generated **from
  record state**, numbered, audited and non-deletable, rather than free-text
  templates. A TC must be derivable from enrollment history, not typed.
- **Owning module** — `reporting` (`rpt_`) for generation; `people` (`ppl_`) for
  the enrollment facts.
- **Security/privacy** — High. Certificates are identity documents.
- **Phase** — 1 (TC/bonafide), 2 (ID cards, branding).
- **Validation** — Unvalidated.

### 5.2 Promotion, transfer and exit

- **Alma [A1, PUBLIC]** — "Enrollment history", "Re-enrollment", "Registration",
  "Cross-district enrollment" (state-agency tier).
- **Vidya current state** — **Partial** (N6, 2026-09-26). An administrator
  previews and applies one section's promotion, detention, transfer-out and
  graduation as one audited batch; concluded enrollment rows keep their
  outcome and reason, and exits apply ADR-0027 Decision 9 to guardian access.
  An audited one-pupil correction retains the original record and refuses
  dependent next-year records. A versioned per-school guardian history window
  governs future exits without rewriting existing exit dates. Database
  concurrency and browser journeys pass; mid-year exit entry and real-school
  pilot review remain.
- **India requirement** — Year-end promotion is an annual all-school event with
  legal weight; detention rules vary by board and state.
- **Proposed Vidya workflow / why better** — Promotion as an **auditable batch
  with a preview and a reversible outcome per student**, never an in-place
  status overwrite. No hard deletion of prior enrollment rows.
- **Owning module** — `people` (`ppl_`).
- **Phase** — 1.
- **Validation** — Unvalidated.

---

## Priority 6 — Operational breadth

Recorded for completeness. **All deferred until the school core passes a paid
pilot.** Each is a real domain, not a CRUD page.

| Capability | Alma [A1, PUBLIC] | EdPlus [E1, PUBLIC] | Vidya | Phase |
|---|---|---|---|---|
| Incidents / discipline | "Customizable incident codes", "Minors & majors", "Workflow tools", "Multiple students on same report", "Embedded messaging" | — | Missing | 4 |
| Transport | — | — (not on home page; claimed in 65+ modules) | Missing | 4 |
| Library | — | — | Missing | 4 |
| Inventory / assets | — | — | Missing | 4 |
| Canteen | — | — | Missing | 4 |
| Activities | "After school activities", "Flexible groups" | — | Missing | 4 |
| Visitor / front desk | — | — | Missing | 4 |
| Health / medical | "Critical medical data", "Immunizations", "Critical flags" | — | Missing (privacy-sensitive) | 4 |
| Staff / HR | — | "Staff Management" | Partial — teachers + `leave` (`lvs_`) exist; attendance/accrual/payroll Missing | 2 |
| Income / expenses | — | "Income / Expenses" | Missing (school-side accounting) | 4 |

**Note on medical data:** Alma advertises immunizations and critical medical
flags. Vidya should treat any health field as a distinct, strictly-gated
privacy class, not an ordinary custom field. Deferring it is the correct call
until that gating exists.

---

## Priority 7 — Integrations and advanced analytics

- **Alma [A1, PUBLIC]** — "125+ push button integrations", "Google Classroom
  integration", "Numerous LMS integrations", "Public APIs", "One-roster (API &
  SFTP)", "BI tool connector", "BeaconAI – Built-in data analytics package",
  "Build-your-own reporting", "Embedded data visualizations".
- **EdPlus [E1, PUBLIC]** — "AI Manager", "10 Lakh Questions Bank",
  "Website", "White Label App".
- **[INFERENCE]** — Alma's integration count is a US-ecosystem asset
  (OneRoster, Google Classroom, state SEAs) with limited Indian relevance.
  EdPlus's "AI Manager" and question bank are differently shaped — content and
  assistance rather than interoperability. Neither is a near-term parity
  requirement for Vidya.
- **Vidya current state** — **Partial**. `analytics` module (`anl_`) with 7
  routes including at-risk and distribution, governed by a minimum-cohort rule
  and field-gating (ADR-0018, ADR-0020). OpenAPI is generated from route schemas
  and drift-checked in CI. No third-party integrations.
- **Proposed Vidya workflow / why better** — Vidya's analytics already refuse to
  disclose below a minimum cohort and inherit scope closure — analytics as a
  *disclosure surface*, not a dashboard. Keep that. Explicitly **do not** chase
  an integration count.
- **Phase** — 4+.
- **Validation** — Unvalidated.

---

## Priority 8 — SaaS owner control plane (no benchmark parity)

Neither Alma nor EdPlus publicly documents a vendor control plane, because it is
internal to them. There is **no parity row here** — this is Vidya-specific and
must be designed from first principles.

- **Actor / JTBD** — The Vidya operator provisions a new school, sets its plan
  and subscription dates, verifies a renewal payment, watches health and queue
  depth, and performs an audited support action.
- **Vidya current state** — **Missing.** A `system` module (`sys_`) exists with
  health, ready, metrics, license and a tenant-scoped audit log (ADR-0025).
  That is tenant-plane infrastructure, not a control plane.
- **Non-negotiables** — Owner administrators are distinct from school
  administrators. Subscription expiry **never** deletes school data. Trial,
  active, past-due, grace, restricted, suspended, cancelled and export states
  must all be defined before release. Entitlements are enforced server-side. ERP
  subscription billing never mixes with the school fee ledger.
- **Phase** — 3.
- **Validation** — N/A (internal).

---

## Honest position statement

Vidya now has a connected pupil record, a relationship-gated family web portal,
published immutable report cards, and audited school fees. Its verified design
strengths include scoped analytics, transactional financial audit, module-owned
data and an explicit weighted-results rounding contract. These are Vidya code
facts, **not** evidence that a competitor lacks the same qualities.

Vidya still lacks admissions, a mid-year single-pupil exit entry, certificates, bulk marks
import, guided onboarding, multiple school operations modules, a native app,
and the hosted vendor control plane. It has not completed a real-school term or
customer acceptance. The dated checkpoint above supersedes older current-state
claims in the priority rows; do not present those rows as current release proof.

**Market parity requires completed workflows, correctness, onboarding,
supportability and evidence from actual school users.** No row is validated on
the strength of a competitor marketing page.
