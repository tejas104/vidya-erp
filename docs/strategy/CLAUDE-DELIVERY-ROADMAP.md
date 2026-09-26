# Vidya delivery roadmap

Maintained by the Vidya product/implementation owner. Revised as evidence
changes — this is a living record, not a plan written once.

- Branch: `codex/claude-school-product`
- Worktree: `D:\ATLAS\.worktrees\claude-school-product`
- Base: `a9d5fc16f075b86474050fbefd4f0860ac21f006` (gate-04 reviewed checkpoint)
- Integration commit: `0ddf80cc3ab8ff1ecc1b663fd0e6d152badeb161`
- Last revised: 2026-09-25 (school marks CSV import increment)

Companion documents: [COMPETITIVE-PARITY-MATRIX.md](COMPETITIVE-PARITY-MATRIX.md),
`DELIVERY-AND-REVIEW-REQUIREMENTS.md`, `VIDYA-SCHOOL-FIRST-SAAS-PLAN.md`.

## Status legend

`DONE` · `IN PROGRESS` · `BLOCKED` · `NEXT` · `PLANNED` · `DEFERRED`

A slice is `DONE` only against the 12-point Definition of Done in the owner
brief. Schema alone, backend alone, UI alone or a document alone is not `DONE`.

### 2026-09-25 continuation checkpoint

The owner asked to complete the wider school ERP while comparing Alma, EdPlus
and Vidyalaya. Their public feature pages were rechecked; the dated current
state is in [COMPETITIVE-PARITY-MATRIX.md](COMPETITIVE-PARITY-MATRIX.md). Public
module lists guide job selection but do not prove workflow quality or parity.

The local school demo now includes audited teacher attendance and scoped
PDF/Excel/CSV exports (`e14f43b` through `b903823`). Analytics adds Columns,
Line, Area and exact Data views for monthly attendance (`6a7898c`). The marks
desk now has a section roster CSV template, row validation, change preview,
downloadable error CSV and an atomic, audit-logged batch save. The save checks
the previewed score under the term lock, so a concurrent correction rejects
the import instead of overwriting it. A seeded teacher browser journey
exercised error and success paths, then restored the original mark. N4 still
needs a measured pilot-size import and scaling decision; the browser preview
is not a persisted, server-side import job.

N5 attendance shortfall and unsubmitted-register handling, N6 promotion and
transfer, N7 certificates, N8 fee follow-up, and Phase 2/3 admissions,
finance depth and hosted control-plane work remain on the critical path. This
local demo evidence does not replace full school and hosting gates.

---

## Phase 0 — Integrate reviewed work and establish a green baseline

**Status: DONE** (2026-09-23)

### Integration result

Created `codex/claude-school-product` from `a9d5fc1` in a dedicated worktree.
Cherry-picked the three post-gate commits individually with `-x`:

| Source commit | Subject | Result |
|---|---|---|
| `a05598d` | test(school): add isolated browser verification harness | clean → `144c9d1` |
| `6b28852` | feat(school): add report card desk | clean → `4b416e3` |
| `2b3d572` | feat(platform,fees): commit payment/adjustment audit rows atomically (S05, F5) | clean → `0ddf80c` |

**Zero conflicts.** No manual resolution was required, so no resolution
decisions need recording.

### Verification of the brief's integration instructions

The brief stated `4fc1e65` is a duplicate already present in the reviewed base.
This was verified rather than assumed, and the instruction is **correct** —
though not by ancestry:

- `4fc1e65` is **not** an ancestor of `a9d5fc1`.
- The base is a **rebase/replay** of both the Terra and Sonnet chains onto
  `67fd54a`. `git patch-id --stable` confirms `4fc1e65` and base commit
  `b0b1a10` are byte-identical patches, as are Terra's `c768a40` and base
  `8cf34ea`.
- `git cherry a9d5fc1 <branch>` marks exactly three commits as novel (`+`) —
  the three named in the brief — and every other commit on both branches as
  already present (`-`).

Cherry-picking only the three named commits was therefore correct, and the six
other Terra commits and nine other Sonnet commits were correctly skipped.

### Baseline evidence (all on `0ddf80c`)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS (all 16 modules + web + worker) |
| Lint | `pnpm lint` | PASS (incl. no-ad-hoc-hex, on-scale checks) |
| Unit | `pnpm test` | PASS — 93 files, **1089 tests** |
| UI | `pnpm test:ui` | PASS — 67 files, **301 tests** |
| Integration | `pnpm test:integration` | PASS — 18 files, **114 tests** |
| OpenAPI drift | `pnpm openapi:check` | PASS — spec up to date |
| Table ownership | `pnpm check:ownership` | PASS — 16 module prefixes verified |
| Production build | `pnpm build` | PASS — help compiled, Next.js build exit 0 |

Integration tests ran against the disposable `vidya_integration` database
(never the demo database), per `tests/integration/support/db-url.ts`, with
`INTEGRATION_RESET_DB=true`.

#### One environmental finding, diagnosed not masked

The first integration run showed 8 failures. Both causes were environmental:

1. **MinIO credentials absent** (`InvalidAccessKeyId`) — the suite needs
   `S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET`.
2. **BullMQ queue contention** — `tests/integration/heartbeat-job.int.test.ts`
   failed because the owner's running `atlas-worker-1` container shares the same
   Redis instance and database index, and derives the same queue name from
   `SYSTEM_MODULE_NAME`. The container worker won the race and wrote its audit
   row to the **demo** database, while the test asserted against the
   **integration** database.

   Confirmed by re-running the same test against an isolated Redis db index
   (`redis://…/3`): passes. The owner's running stack was **not** stopped,
   reset or modified.

**Action for the run recipe:** integration runs on a machine with the compose
stack up must use a dedicated Redis db index. This supersedes the previous
"suite only goes green with the worker running" note, which described the e2e
suite, not the integration suite.

---

## Phase 1 — School core correctness and parent essentials

Objective: the school edition is academically and financially correct, and a
parent can be given access safely.

| # | Slice | Status | Blocker / note |
|---|---|---|---|
| 1.1 | **Immutable school report-card backend** | **DONE** (`4684044`) | Evidence below. |
| 1.2 | Live school browser proof | **DONE** | 5/5 journeys pass on the isolated stack (terms ×2, marks, report cards, guardian). |
| 1.3 | Guardian identity + authorization ADR | `DONE` | ADR-0027 accepted by the owner 2026-09-23; implemented in `bd7a3db` and `60f3a66`. |
| 1.4 | Parent portal essentials | `DONE (first slice)` | Invitation → activation → family portal (attendance, marks, timetable) reusing `portal` read models behind people's guardian access decision. See "Slice 1.3/1.4 — delivered" below for what is deferred. |
| 1.5 | Promotion / detention / transfer | `DONE (local demo)` | Section batch and a separate one-pupil exit for today use server preview, transactional apply, per-pupil and batch audit, and preserved enrollment history. An audited one-pupil correction and a versioned per-school guardian history window are implemented. Real-school acceptance remains a later gate. See N6 below. |
| 1.6 | Certificates (TC, bonafide) | `PLANNED` | Generated from record state, numbered and audited — not free-text templates. |
| 1.7 | Bulk marks import | `IN PROGRESS` | Teacher CSV template, browser preview, error CSV and atomic compare-and-save work locally. Measure a pilot-sized class and decide whether to add a persistent worker import run. |
| 1.8 | Attendance shortfall workflow | `PLANNED` | Wire S02; must show the denominator and separate pupil absence from unsubmitted registers. |
| 1.9 | Fee-defaulter workflow depth | `PLANNED` | `defaulters` route exists; printable notices and follow-up state do not. |

### Slice 1.1 — acceptance boundary (active)

**In scope.** Four routes satisfying the exact contract in
`apps/web/src/ui/api.ts`:

| Route | Returns |
|---|---|
| `GET /api/v1/school/report-cards/classes/{classId}?termId=` | `{ students: [{ studentId, fullName, admissionNo, snapshotId, generatedAt }] }` |
| `POST /api/v1/school/report-cards/preview` | subjects / overall / attendance / warnings |
| `POST /api/v1/school/report-cards` | `{ snapshotId, generatedAt }` |
| `GET /api/v1/school/report-cards/{snapshotId}/download` | PDF rendered from the stored snapshot |

Plus: reporting-owned immutable snapshot tables (`rpt_` prefix); S01 and S02
consumed through **module public APIs**; per-route server-side authorization;
generation audited; additive migration with a paired rollback; migration up/down
test; API/service/database/PDF tests.

**Explicitly out of scope for this slice.** Parent-facing download (needs 1.3);
bulk/class-wide generation; report-card template configuration and school
branding; transcripts across terms; promotion decisions derived from the report
card.

**Correctness invariants.**

- A snapshot is immutable once written. Regeneration creates a **new** snapshot;
  the prior snapshot's rendered content does not change.
- Missing marks and missing attendance stay explicitly missing. Nothing is
  coerced to zero, and no attendance or promotion threshold is assumed.
- The PDF renders **from the stored snapshot**, never by recomputation.
- The calculation engines are **not** duplicated and no other module's tables are
  queried directly.

### Slice 1.1 — delivered (commit `4684044`)

**Routes** (OpenAPI grew 141 → 145; all four match the contract in
`apps/web/src/ui/api.ts` exactly):

| Route | Authorization |
|---|---|
| `GET /api/v1/school/report-cards/classes/{classId}` | resolved class path, `read` |
| `POST /api/v1/school/report-cards/preview` | pupil position from enrollment, `read`, audited |
| `POST /api/v1/school/report-cards` | pupil position from enrollment, `read`, audited |
| `GET /api/v1/school/report-cards/{snapshotId}/download` | org path stored on the snapshot, re-checked against current scope, audited |

**Engine composition (no duplication).** S01 and S02 are now published through
their owning modules' public APIs, with two new read models supplying source
facts: `SchoolAcademicsReadModel.termResultSource` (`sca_`) and
`AcademicsReadModel.sectionAttendanceWindow` (`acd_`). Reporting performs no
academic arithmetic and touches no other module's tables.

**Decisions recorded, not buried.**

- Generation and download authorize on **`read`, not `create`**. The approved
  role/scope matrix (ADR-0010, human-owned core) grants `create` only on
  `identity` and `people`, so *no* role could issue a report card under a
  `create` check — including the class teacher whose job it is. This matches
  the existing queued `/api/v1/reports` flow, which also gates on the authority
  to read the records it discloses. The core was **not** modified.
- The **preview is audited**. Constitution rule 7 (enforced at bind time by
  `defineRoute`) requires every POST to declare an audit action, and a preview
  discloses a pupil's entire academic standing, so this is correct rather than
  merely compliant.
- **Attendance policy is a constant, not a setting**: late counts as present,
  excused leaves the denominator, half-day earns half credit; within-type
  aggregation is `earned-points`. All four are recorded on every snapshot's
  provenance, so introducing a per-term setting later cannot make an
  already-issued card ambiguous.
- **Instructional days are derived from evidence** — a date on which the
  section's register was taken. There is still no explicit school-calendar
  authority (see risks); this is the defensible interim source and it keeps
  "register never submitted" distinct from "pupil absent".
- The routes live on `reporting` (`rpt_`), which has no edition gate, so they
  exist on a college install too. Migrations run on every edition by design
  (ADR-0024), so `sca_` is present-but-empty there and the routes answer 404.

**Two corrections found in self-review of the diff, both fixed in the commit:**

1. *Security.* An unenrolled pupil returned 422 **before** any scope check,
   letting an unauthorized caller distinguish "no such pupil" (404) from
   "exists but unenrolled" (422) by walking ids — a membership oracle over the
   student roll. Now authorized against the resolved college first; regression
   test added.
2. *Correctness.* The attendance session bound (2,000) was reachable by a real
   term, which would have silently understated expected days and **overstated**
   attendance — the exact failure this slice exists to prevent. Raised beyond
   what a term can produce, with the arithmetic recorded in the code.

A third was found by a failing test rather than review: pdfkit stamps a live
`/CreationDate`, so reprints were not byte-identical and a reprint claimed
today as its creation date. `CreationDate` is now pinned to the issue time.

**Evidence** (all on `4684044`):

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm openapi:check` | PASS |
| `pnpm check:ownership` | PASS (16 prefixes) |
| `pnpm build` | PASS — all four routes present in the build output |
| `pnpm test` | PASS — **1109** (was 1089) |
| `pnpm test:ui` | PASS — 301 |
| `pnpm test:integration` | PASS — **125** (was 114) |
| Migration `reporting/0003` up → down → up | PASS on real Postgres via the migration harness |

Proved against **real Postgres**, not mocks: the database refuses `UPDATE` and
`DELETE` on an issued snapshot (trigger, `restrict_violation`); a reprint of a
superseded snapshot is **byte-identical** after a mark correction while a new
snapshot reflects it; a cross-school term is refused 422; a guessed snapshot id
is refused 403 before any bytes are produced; an unauthorized caller gets 403
rather than the informative 422.

**Not claimed.** No live browser journey had been executed at the time of this
commit, so no browser evidence is asserted for it. Parent-facing download, bulk
generation, report-card templates and branding are out of scope.

### Slice 1.2 — live school browser proof

Gate-04 recorded that the school journeys had been **listed** but never run,
and named this release evidence rather than polish. They have now been
**executed**.

`pnpm test:e2e:school` was run against the isolated disposable stack the
harness provisions (Compose project `vidya-school-e2e`; Postgres `:55435` /
`vidya_school_e2e`, Redis `:6385`, MinIO `:9010`, production web server
`:3115` — all separate from local development, from the integration database
and from the owner's running stack).

Result: **3 tests passed in 19.6s**, in a real Chromium against a production
`VIDYA_EDITION=school` build.

| Journey | Result |
|---|---|
| `marks.spec.ts` — subject teacher creates an assessment, saves grades, observes closure | ok (5.2s) |
| `terms.spec.ts` — school admin configures weights, closes a term, reopens with a recorded reason | ok (3.5s) |
| `terms.spec.ts` — school management screens fit mobile in both themes | ok (2.6s) |

The run also confirmed `reporting/0003_school_report_cards` applies cleanly in
a fresh database (35 migrations applied), and the runner's cleanup reported
that only labelled test resources were removed.

**Scope of this evidence, stated precisely.** These are the T04 journeys. They
do **not** exercise report cards — the runner's spec list predates that work.
`tests/e2e/school/report-cards.spec.ts` has been written and registered in
`scripts/school-e2e.ts`; its execution is tracked separately and is not claimed
until it has actually run.

---

### Slice 1.3/1.4 — delivered

Commits `bd7a3db` (principal + route gate), `60f3a66` (tables, lifecycle,
family API) and the family UI commit that follows them.

Evidence: 1501 unit + UI tests; 138 integration tests over real Postgres, 13
of them guardian cases, including a guardian being refused on routes written
before guardians existed; 5/5 school browser journeys, the new one driving
invite → activate → sign in → family portal → refused by the staff API.

Found while building, recorded in ADR-0027 as Finding C: 73 routes admitted
"any authenticated principal", so a guardian would have passed the route gate
on all of them. Closed at the gate (`AccessRequirement.audience`, default
staff), not per route.

Also found: the student record page is built on the analytics read, which
refuses the administrator. The guardians panel is mounted independently of
it; the page itself remains a Student 360 gap.

Deliberately deferred, each its own slice:

| Deferred | Why it is safe to defer |
|---|---|
| Delivering the code by SMS/email | Staff hand the code over today; ADR-0027 Decision 7 left the vendor open. |
| Editing restrictions and per-relationship categories | Stored and enforced by the adapter already; there is no UI to set them. |
| ~~Setting `historicalAccessUntil` on transfer/graduation (Decision 9)~~ | Done in N6: exits stamp the school's configured 0–365 day window, defaulting to 90; later setting changes do not rewrite issued dates. |
| Parent views of fees, notices, homework, report cards | The categories exist and are enforced; the read routes are not built. Report cards must pass `publicationState`. |
| Reaping a guardian login left without a relationship after a lost activation race | Such an account holds no authority; marked `ponytail:` in the service. |

## Next plan — ordered slices (from 2026-09-24)

This is the working order for the next owner. Each slice is dependency-complete
and must meet the 12-point Definition of Done. Reorder only with a recorded
reason; add slices freely when evidence demands it.

| # | Slice | Why now | Owning module(s) | Depends on |
|---|---|---|---|---|
| **N0** | Independent adversarial review of `c530ba8..c199589` — **DONE** | Concurrency, scope, and account-kind fixes below; full gates green. | all touched | — |
| **N1** | Student 360 v1 — **DONE** | People-owned profile and history, independently loaded tabs, and six school browser journeys pass. | web; `people` and `system` audit index | N0 |
| **N-UI1** | School workbench foundation — **IN PROGRESS** | Owner requested an ERP-wide UI redesign. Start with a named, keyboard-usable long-table pattern in the student roster, accountant directory and fee ledger; continue by role and screen under [SCHOOL-EXPERIENCE-REDESIGN.md](SCHOOL-EXPERIENCE-REDESIGN.md). | `ui-system`, web | N1 |
| **N-UI1.1** | School staff home and local demo — **DONE** | Administrator, principal, class teacher and subject teacher have distinct task-first school homes and permitted navigation. A separate labelled Compose school, synthetic records and six role accounts support desktop and 390 px browser review. The seed waits for attendance rollups, while school term marks link to their own records. See [local demo guide](../demo/SCHOOL-LOCAL-DEMO.md). This is a UI/demo slice within the wider N-UI1 redesign. | web, scripts, docs | N-UI1 |
| **N2** | Report-card desk for class teachers — **DONE** | A reporting-owned desk scope now lists only readable classes and their school's terms; the class teacher sees the desk in school navigation. Real browser and integration scope checks cover the audience. | web; `reporting`, `school-academics` read model | — |
| **N3** | Parent views: report cards, fees, notices — **DONE** | Family fee balances/receipts, audience-filtered live notices, and explicitly released report cards use fresh child-category checks. Report-card publication and withdrawal are append-only; family PDFs require the current release. Real browser and database tests cover release, supersession, withdrawal, sibling denial, and relationship revocation. | `reporting`, `fees`, `notices`, web | N0 |
| **N3.1** | School family and student term marks — **DONE** | Separate school marks routes use the school-academics read model and weighted engine. A new close stamps release; historical closed terms remain private until an audited admin release. Reopening hides them during correction. Student self-scope and fresh guardian marks checks apply. Subject and assessment details distinguish missing scores from zero, and incomplete data blocks the overall percentage. College marks routes are unavailable in the school edition. Type, unit, UI, integration, migration, and isolated browser gates pass. See [ADR-0029](../adr/0029-school-term-marks-release.md). | `school-academics`, `portal`, web | N3 |
| **N4** | Bulk marks import (1.7) — **IN PROGRESS** | CSV teacher flow and compare-and-save shipped for the local demo; measured scaling and full review remain. | `school-academics`, web | — |
| **N5** | Attendance shortfall workflow (1.8) — **IN PROGRESS** | Term-level instructional days and threshold, a version-guarded admin editor, and a scoped review distinguish unsubmitted daily registers, missing pupil entries and confirmed shortfall. Effective enrollment dates drive expected days across historical section rows and report-card previews; unverified legacy dates withhold the percentage. Staff can enter dates on admission/transfer and administrators can auditably correct them. Scoped PDF, Excel and CSV review exports now use the same calculation. Notification/escalation policy and real-school pilot review remain open. | `school-academics`, `academics`, `people`, `reporting`, web | — |
| **N6** | Promotion / detention / transfer (1.5) — **DONE (local demo)** | Administrator page **Promotion and exits** has a section year-end batch and a one-pupil transfer/graduation entry for today. Every exit needs a reason. Both use the same preview, transactional apply, enrollment history, guardian window and invitation revocation, with a workflow marker in the audit. The versioned per-school guardian history window, audited per-pupil correction, and next-year dependent-write guards remain in place. The single-exit browser journey and the isolated Postgres integration suite pass. A whole-school pilot and school sign-off remain separate gates. | `people`, `reporting`, `portal`, web | N1 |
| **N7** | Certificates: TC and bonafide (1.6) — **FOUNDATION IN PROGRESS** | A school-scoped, audited document-format editor now versions PDF presentation and stores private PDF/DOCX reference samples. Report cards freeze the style at issue and attendance PDFs at request. Certificate format settings exist, but certificate issuance, numbering, signing, verification, correction and full layout mapping are still open. Use recorded exits by default and an explicitly audited manual exception; follow the [owner decisions](SCHOOL-IMPLEMENTATION-DECISIONS-2026-09-26.md) and [ADR-0031](../adr/0031-school-document-formats.md). | `reporting`, `people` | N6 |
| **N8** | Fee-defaulter workflow depth (1.9) | Printable notices and follow-up state on the existing `defaulters` route. | `fees` | — |
| **N9** | Guardian invitation delivery (SMS/email adapter) | Removes the manual code hand-off; needs a provider decision from the owner. | `notices` or a new `ntf_` adapter | owner vendor choice |
| **N10** | SaaS control plane — **FOUNDATION IN PROGRESS** | ADR-0030 fixes the isolated-tenant boundary. A separate vendor registry/subscription/audit migration, pure 30-day grace policy and a development-only fictional operator dashboard preview now exist, with focused real-database and desktop/phone browser proof. Named operator MFA, live dashboard wiring, provisioner, signed entitlements, billing, two-tenant isolation, restore and operations remain open. The [hosting readiness register](HOSTING-READINESS-2026-09-24.md) remains the release gate. | `control-plane`, `operator`, docs | — |

### N0 adversarial guardian review — 2026-09-24

The review traced all 177 declared routes to Next route files, checked all 156
API route files for the shared `routeHandler` gate, and pinned public, guardian,
and session-self route audiences in a regression test. Production composition
uses the Redis-backed password limiter for activation. Staff checks use the
student's resolved org position; live guardian reads resolve relationships on
each request. The portal's unrelated and unknown child IDs have the same 403
response. The nav reorder did not change role gates or destinations.

| Severity | Finding | Correction |
|---|---|---|
| High | Claims of two different valid codes could each observe one fewer live relationship and both pass the self-attestation threshold. | Serialize invitation issue and claim on the pupil row; count live relationships inside the claim transaction. |
| High | Reissue revoked older pending codes and inserted a new code in separate transactions, allowing concurrent reissues to leave two usable codes. | Revoke and insert in one pupil-locked transaction; claim uses the same lock order. |
| Medium | An unauthorized staff caller could distinguish a revoked relationship because verify checked state before scope. | Scope-check first, then return the state conflict. |
| Medium | Concurrent verify could re-activate a relationship just revoked by staff. | Compare the expected relationship status in the verification update; a stale change returns 409. |
| Medium | Admin users list did not identify guardian logins, so the UI presented actions the server would reject. | Return account kind and label guardians; remove grant and role controls for those rows. |

Accepted follow-up: a losing same-code activation can leave an inactive guardian
login with no relationship or authority. It cannot read a pupil record, but
operations should later provide a safe reap/retry path for that username.
The review does not imply provider delivery, SaaS readiness, or real school UAT.

N0 verification on the corrected tree: `pnpm typecheck`, `pnpm lint`,
`pnpm openapi:check`, all three check scripts, and `pnpm build` passed;
`pnpm test` passed 98 files / 1,199 tests, `pnpm test:ui` passed 68 files /
306 tests, and the disposable `pnpm test:integration` passed 20 files /
143 tests. The focused guardian integration suite passed 18/18 on real
PostgreSQL. No browser journey was added for this backend/security review;
N1 adds the new Student 360 journey.

### N1 Student 360 v1 — implementation and verification

The profile now loads from `people.student-get`, including class and section
names, independently of analytics. Summary, Academics, Attendance, Finance,
Documents, Family and History each load their own source with local loading,
error, retry and denial states. The selected tab stays in `?tab=`. The new
`people.student-history` route checks read scope at the pupil's current org
position, returns every enrollment row (including withdrawn rows), derives
status changes from student audit events, and reads student and enrollment
events through the system module's public port. The response exposes event
action, actor and time, but never raw audit details. Keyset paging and the new
`sys_audit_log_resource_history_idx` support resource history as audit volume
grows; the index has a paired down migration and an up/down/up integration gate.
Class-roster drawers and the accountant directory now link to the record;
search and at-risk links already did. School student help is included.

Verification: `pnpm typecheck`, `pnpm lint`, `pnpm openapi:check`, all three
repository check scripts, and `pnpm build` passed. `pnpm test` passed 98 files /
1,199 tests; `pnpm test:ui` passed 69 files / 308 tests; the full disposable
`pnpm test:integration` passed 21 files / 145 tests, including the resource
cursor audit read and migration up/down/up check. The labelled disposable
school browser stack ran **6/6** journeys, including the new Student 360
journey, and removed only its own resources. At 390 px, the Student 360 page
had no document overflow, a settled sidebar outside the viewport, and the
selected deep-linked tab visible in the horizontal tab strip. The
first browser attempt had a strict locator matching both the header and
History row; the corrected selector and per-tab content waits passed.

Known boundary: the Academics and Attendance source routes are row-filtered and
may answer 200 with an empty array when no rows are visible. The accountant
screen displays “Not in your scope” based on the account's role, but the API
does not itself distinguish “no data” from “no scoped data” in that case.
This needs an explicit response-state contract before clients interpret an
empty academic read as proof that no record exists. The Documents tab provides
read/download; authorized upload and removal remain on the student management
screen. These do not alter the server's existing permissions.

### N-UI1 school workbench foundation — first checkpoint

The owner widened the UI brief on 2026-09-24: redesign the full school ERP
around public Alma, EdPlus and Vidyalaya references, with permission to revise
earlier UI rules. The clean-room job map, component contract and rollout are
recorded in [SCHOOL-EXPERIENCE-REDESIGN.md](SCHOOL-EXPERIENCE-REDESIGN.md).
The previous blanket ban on palette, type and shell changes in
[SCHOOL-UI-DIRECTION.md](SCHOOL-UI-DIRECTION.md) is superseded; any such change
still needs paired accessibility and browser evidence. The school-first and
server-authorization contracts remain in force.

This checkpoint fixes one repeated operational pattern. The shared `Table`
has a named, keyboard-focusable bounded scroll region whose header actually
sticks as a long roster moves. Its data rows have a 44 px minimum, narrow
screens keep columns wide enough to read, and a visible hint explains sideways
scrolling. The student roster, accountant directory and invoice ledger use it.
The labelled browser stack passed **7/7** journeys, including a 20-student
roster that checked sticky positioning, a focused region, compact rows and no
document overflow at 390 px. Its resources were removed by the ownership-
checked cleanup. The component UI check passed 3/3. This is a foundation
checkpoint; task headers, saved filters, bulk actions, role workspaces and
family redesign remain open in the redesign plan.

Final code-tree gates: typecheck, lint, OpenAPI check, ownership/TODO/Docker
checks and production build passed; unit **98 files / 1,199 tests**, UI
**69 files / 309 tests**, and disposable integration **21 files / 145 tests**
passed. The new browser roster journey uses 20 pupils and checks a bounded
vertical scroll, sticky column header, keyboard focus, horizontal mobile
scroll, compact data row and no document overflow. The 7/7 browser pass and
labelled cleanup were repeated after the responsive width correction.

Cross-cutting improvements, done alongside slices rather than as a phase:

| # | Improvement | Note |
|---|---|---|
| N-X1 — DONE | Discover school E2E specs and gate them in CI | `scripts/school-e2e.ts` reads every `*.spec.ts` in `tests/e2e/school` and fails if none exist; CI runs the labelled isolated school suite after the college browser gate. Local execution is recorded below; remote CI still needs an exact-SHA run. |
| N-X2 | Inline-style cleanup (UI direction slice 5) | `style={{…}}` in pages escapes `check-scale.mjs`. Migrate a page when a slice touches it. |
| N-X3 | One dense table pattern (UI direction slice 3) | Sticky header, saved filters, bulk bar, "none" vs "not recorded". |
| N-X4 | Help docs per slice | 26 school screens lack help; `family`, `activate` among them. |
| N-X5 | Flaky UI test | `apps/web/src/ui/attendance-page.test.tsx` failed once under a loaded full run and passed 3/3 alone. Diagnose timing; do not add retries. |

N-X1 local proof (2026-09-24): the runner discovered six school spec files,
executed **7/7** tests against its production school build, and removed only
the labelled disposable containers, volumes and network. Typecheck, lint,
ownership, TODO and Docker manifest checks passed. CI now declares the same
school run after the college browser gate; no remote CI result is claimed for
this local commit.

## Phase 2 — Paid-pilot school core

Objective: a school can run a full term on Vidya without a spreadsheet beside it.

| Slice | Status | Note |
|---|---|---|
| Admissions / enquiry → application → seat → fee handoff | `PLANNED` | |
| Re-enrollment | `PLANNED` | Pairs with 1.5. |
| Finance depth: concessions, installments, fines, reconciliation | `PLANNED` | Builds on the hardened fee core. |
| Cheque / settlement state | `PLANNED` | |
| Configurable school documents and branding | `PLANNED` | |
| Staff attendance, leave accrual, substitution | `PLANNED` | `leave` (`lvs_`) exists; links to `ttb_` for substitution. |
| Parent communication + consent/opt-out + delivery logs | `PLANNED` | External providers stay adapters. TRAI/DLT relevant. |
| Guided onboarding and Excel migration | `PLANNED` | Benchmark pressure from EdPlus's 30-minute claim. |
| Operational alerts | `PLANNED` | |

**Payroll note.** Statutory Indian payroll is **DEFERRED** until its compliance
scope and a named maintenance owner exist. Prefer an integration boundary first.

---

## Phase 3 — Repeatable SaaS

Objective: Vidya can be sold and operated for many schools by one small team.

Hosted vendor control plane · provisioning · edition/plan entitlements ·
subscription lifecycle (trial, active, past-due, grace, restricted, suspended,
cancelled, export/offboarding) · invoices and verified renewal · feature limits ·
release version · backup/restore status · health, queue depth, disk alerts ·
staged upgrade and rollback · audited support actions · tenant inventory.

Non-negotiables: owner admins distinct from school admins with strong auth;
entitlements enforced server-side; **subscription expiry never deletes school
data**; ERP subscription billing never mixes with the school fee ledger; start
with managed isolated tenant environments and one immutable application release.

Architecture is recorded in [ADR-0030](../adr/0030-hosted-control-plane-and-tenant-isolation.md); all implementation items remain `PLANNED`. No hosted tenant or vendor control plane has been deployed.

---

## Phase 4 — Operational expansion

Chosen by **paying-customer evidence**, not by competitor checklist. Transport,
library, inventory/assets/procurement, incidents/discipline, activities,
canteen, visitor/front desk, health records (strictly gated), integrations.

All `DEFERRED` until the school core passes a paid-pilot gate.

---

## Phase 5 — College expansion

Restore college-first terminology where edition-specific; ATKT/re-exam
lifecycle; college admissions; a dedicated student app on the shared versioned
API. All `DEFERRED` until the school edition is sellable.

---

## Open risks

| Risk | Severity | State |
|---|---|---|
| **Guardian identity** — authentication shape, revocation semantics and the identity/people boundary. | High | Closed by ADR-0027 and slices 1.3/1.4. |
| **Student record depends on analytics scope** — `/students/[id]` rendered "Outside your scope" for an administrator because it loaded the analytics performance read. | Medium | Closed in N1. The profile and header load from `people`; analytics is isolated to its own tab. The admin denial regression is covered by a UI test. |
| **No live browser evidence has ever been executed** for school journeys. | High | Closed 2026-09-23: 5 journeys executed and passing. The runner's spec list is hardcoded — see N-X1. |
| **No SaaS control plane exists.** The product is not sellable as SaaS until Phase 3. | High | Open, scheduled Phase 3. |
| **Integration suite shares Redis with the owner's running stack**, causing a false failure in the BullMQ test. | Low | Diagnosed; mitigated with a dedicated Redis db index. Recorded above. |
| **Help coverage is thin** — 26 school screens and 16 college screens have no help doc. | Medium | Open; closed incrementally per slice. |
| **The report-card desk cannot be opened by a class teacher.** The previous page bootstrapped from a college-level list that excluded a class-scoped teacher. | Medium | Closed in N2: the desk uses `GET /api/v1/school/report-cards/desk-scope`, which resolves and checks individual classes before returning choices. The school-wide organization tree remains restricted. |
| **No validation with real school users yet.** Every competitive row is `Unvalidated`. | High | Open. Parity claims must not be made until this changes. |
| Medical/health data is advertised by the benchmark but has no privacy gating in Vidya. | Medium | Correctly deferred until gating exists. |
