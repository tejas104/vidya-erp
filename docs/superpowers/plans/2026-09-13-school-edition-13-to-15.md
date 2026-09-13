# School edition: #13 → #15 implementation plan

**Written:** 2026-09-13. **Branch:** `feat/a11-onboarding-import`.

Every claim about current behaviour below is cited `file:line` and was read, not
assumed. Anything not cited does not exist. Where the assignment text and the
codebase disagree, the disagreement is written down rather than silently resolved.

---

## 0. Status at a glance

| | State |
|---|---|
| **#13 editions** | **COMPLETE** (5 commits, below) |
| **College regression net** | **GREEN — 76 passed, exit 0, verified 2026-09-13** |
| Unit + UI | 802 passed / 82 files |
| Workspace typecheck | exit 0 |
| ESLint | 0 problems |
| Security core (`identity/src/core/`) | **zero diff** — `git diff --stat 2a2a9c2..HEAD -- packages/modules/identity/src/core/` is empty |
| **#14 school academic core** | Not started — surveyed, planned below |
| **#15 school operations** | Not started — planned below |

The green baseline is the single most important fact here. #14 and #15 both
require proving "college behaviour provably unchanged", and that proof is only
possible against a baseline someone has actually watched go green. It had not
been run since 2026-09-11.

---

## 1. What #13 delivered

### 1.1 The audit-log read route (`3dad3ff`) — a pre-existing blocker, not #13 proper

`system.audit-log` had been left half-wired: the handler closure existed but was
never registered in the returned record, the two readers were missing from the
composition root, and no `route.ts` existed. That is **two of this project's three
recurring failure modes live simultaneously** — composition-root drift (only
`pnpm typecheck` sees it) and a RouteSpec with no `route.ts` (green unit tests,
404 endpoint).

`GET /api/v1/system/audit` is now live and admin-only. This answers
`editions.md` open question 5 on the read-path side: `system.clock-rollback`,
`system.seat-overage`, login failures and lockouts are reachable without SQL.
**The admin UI page that consumes it is still missing** — see §5.

Also regenerated `docs/openapi/openapi.json`, which was stale:
`/api/v1/system/license` had never been written into the spec either.

### 1.2 Edition gating (`0994440`)

- `ModuleDefinition.editions?: readonly LicenseEdition[]`
  (`packages/platform/src/contracts/module.ts`). **Absent means every edition**, so
  the fifteen existing modules needed no change and a module is only ever
  edition-scoped by explicitly saying so.
- `moduleRunsOnEdition(module, edition)` — one shared predicate used by **both**
  composition roots (`apps/web/src/composition.ts`, `apps/worker/src/main.ts`). A
  worker consuming jobs for a module the web app never registered is exactly the
  drift this prevents.
- **Runtime, not build-time.** One image ships both editions. An excluded module's
  endpoints 404 rather than 403 — on that edition they do not exist.
  Build-time-per-edition was rejected because it doubles the #12 Part 5 install
  matrix, which is already blocked on a licence token.

### 1.3 School org tree (`428c4ff`) — ADR-0023

The school tree is **school → standard → section** (owner ruling, 2026-09-12),
built on the existing four-level tree with **one implicit department per school**
that the UI and API never render or accept.

Why not a physically three-level tree:

- `ppl_classes.department_id` and `ppl_subjects.department_id` are both NOT NULL
  (`packages/modules/people/src/db/schema.ts:41`, `:58`).
- `OrgDirectory.verifyOrgPath` refuses a `classId` without a `departmentId`
  (`packages/modules/people/src/service/org-service.ts:40-42`).

Making the level nullable means a migration on two tables **shared with college**,
plus every join, grant-derivation path and containment check handling the hole.

**Correction to the original option text, which was wrong:** the new tree does
*not* require divergent `ScopeChecker` grant shapes. `covers()`
(`packages/modules/identity/src/core/scope-checker.ts:24-31`) already treats a
level the grant does not specify as "matches anything", so a school path resolves
through the existing checker unmodified and every existing containment probe stays
valid. #14's "zero diff to security-core files" is therefore already satisfiable.

Enforcement: `people.department-create` returns **409** on school. The "exactly
one" invariant is a trust boundary, not a hidden form.

### 1.4 Edition decides the import shape (`1a81dad`)

`editions.md`'s headline finding was that edition decided *nothing* — the only
branch returned identical CSV columns for both arms. Now:

- college: `admission_no, full_name, department_code, class_code, section_name`
- school: `admission_no, full_name, standard_code, section_name`

`ImportService` takes the edition and `people/index.ts` binds it **once**, so the
columns the handlers advertise cannot drift from the columns the service parses.

Observed while testing, better than expected: a college-shaped CSV fed to a school
install fails **loudly**. `section_name` is common to both shapes, so such a file
supplies 1 of the 2 school columns and trips the partial-enrollment error rather
than importing everyone unassigned.

### 1.5 e2e split by edition (`428c4ff`) + help gap measured (`a818900`)

An install's edition is fixed when the **server** boots, so the two suites are two
*runs*, not two projects against one target. The existing 76 journeys stay in the
shared position, keeping the college net byte-identical.

`content/help/school/` was measured, not assumed: a school build **succeeds** and
ships **zero** help docs (`VIDYA_EDITION=school npx tsx scripts/compile-help.ts`
→ `0 doc(s), 29 screen(s) with no help doc`; college has 15). A content gap for
the owner, not an engineering blocker.

---

## 2. Ground truth the plan rests on

Two read-only surveys established the following. **These are the facts that make
#14 larger than its text suggests.**

### 2.1 Does not exist (stated plainly)

| Thing #14/#15 assumes | Reality |
|---|---|
| A reusable S4 fast-path marks-entry component | **Does not exist.** ~40 lines of inline JSX in `apps/web/app/(app)/manage/marks/page.tsx:199-235`. `packages/ui-system` has no keypad or grid primitive. |
| A term entity | **Does not exist.** Free text in exactly two columns: `res_publications.term`, `exm_series.term`. No table, no date ranges, no term↔assessment link. |
| Per-assessment or per-kind weighting | **Does not exist.** Within a subject every assessment counts equally — unweighted mean at `packages/modules/results/src/gpa.ts:19-22`. |
| Stored grades | **Does not exist.** Computed on every read (`results/src/compute.ts:52-85`). |
| Unpublish / reopen / amend | **Does not exist.** Publication is INSERT-only; row existence *is* the state machine. |
| A1–E2 / CBSE preset | **Does not exist.** Only a UI form pre-fill (`manage/results/page.tsx:48-56`). |
| Per-date-range attendance summary | **Does not exist.** All aggregations key on academic year or calendar month. |
| PDF templating / branding / logo / signature blocks | **Does not exist.** Both renderers hardcode the wordmark `"VIDYA"` (`reporting/src/render/pdf.ts:36`); no `doc.image()` call anywhere. |
| BullMQ progress reporting | **Does not exist.** `JobContext` is `{logger, jobId, attempt}`; `updateProgress` is used nowhere. |
| Any batch job producing many artifacts; any PDF byte-merge; any zip | **Does not exist.** |
| Any audit row carrying a data snapshot | **Does not exist.** |
| A fee-receipt PDF | **Does not exist.** Fees prints HTML via `window.print()`. (#12 Part 5's checklist assumes one.) |
| Link between `exm_series`/`exm_slots` and `acd_assessments` | **Does not exist.** Exams is scheduling only. |

### 2.2 Does exist and should be reused

- **Grade scales** — `res_grade_scales.bands jsonb`, per college, admin CRUD, frozen
  once published via FK RESTRICT (`results/migrations/0000_results.sql:24-33`). #14's
  "configurable per school" is mostly reuse.
- **The canonical scope pattern** — copy `marksEnter`
  (`packages/modules/academics/src/api/handlers.ts:471-512`): load the stored record
  first, 404 before 403, one `checkScope(..., marksRef(assessment))` for the batch,
  audit block on success. Plus the **row-filter** variant for lists
  (`:576-578`) and the **double-filter** variant where the outer check is coarser
  than the records (`:626-721`).
- **`subjectId` is the subject/non-subject discriminator** —
  `packages/modules/academics/src/resource-refs.ts:44-77`, always taken from the
  stored row, never from caller input.
- **Progress-by-counter-column** — CSV import proves the pattern end to end:
  `ppl_imports.processed_rows`, `importsRepo.updateProgress`, UI poll loop
  (`apps/web/src/ui/useImportRun.ts:37-54`). Reporting has no equivalent columns.
- **Multi-page PDF in one document** — the class credential sheet already does
  `addPage()` per table (`reporting/src/render/credential-sheet.ts:50-51`).
- **Object storage for uploads** — people's base64 document-upload route
  (`people/src/api/handlers.ts:1065-1100`) is the pattern for a logo.
- **`ReportSources` seam** — how a module injects data into reporting without
  reporting depending on it (`reporting/src/report-data.ts:33-36`,
  `results/src/compute.ts:142-170`, wired at both composition roots).

### 2.3 Pre-existing findings discovered during the survey

These are **not** caused by this work and are **not** in #14/#15's scope, but they
bear on it:

1. **Published results are not immutable.** `academics.marks-enter` and
   `.mark-correct` have no publication check, and academics does not import
   results. A published SGPA silently changes if a teacher edits a mark afterwards.
   Directly relevant: #14 Part 3 wants term close to lock marks entry — school will
   have a guarantee college lacks.
2. **"Attended" means three different things.** present+late+**excused** in
   `sectionRosterAttendance` (`academics/src/api/handlers.ts:336`), but present+late
   in the portal (`portal/src/handlers.ts:80`) and in the rollup builder
   (`analytics/src/service/rollup-builder.ts:145`). A term attendance summary must
   pick one and will disagree with the other two.
3. **Grade-scale freezing is by lock, not snapshot.** Bands are not copied into
   `res_publications`; reproducibility depends on the mutation guard holding.
4. **Read-model positions drop `subjectId`** (`academics/src/index.ts:162-167`,
   `:190-195`), so any consumer re-checking scope from a read-model row sees every
   attendance record as a non-subject record.

---

## 3. Open decisions — owner input needed before the affected part is built

| # | Decision | Why it can't be defaulted |
|---|---|---|
| **D1** | **Where does the report-card data snapshot live?** #14 says "recorded in the audit log with the data snapshot it used". `sys_audit_log.details` is unbounded `jsonb` and the table is **append-only enforced by DB triggers** (`system/migrations/0000_audit_log.sql:25-39`) — no UPDATE/DELETE/TRUNCATE, ever. Writing every report card's marks there means permanent, unprunable PII growth that cannot be corrected or erased. Alternative: snapshot into a reporting-owned table, audit row carries a reference. | Deviates from the assignment text, and is irreversible once shipped. |
| **D2** | **Does configurable branding reopen ADR-0021?** #14 needs school name, logo and signature blocks "without a code change". ADR-0021 explicitly rules a report *designer* out of scope (`docs/adr/0021-pdf-rendering-pdfkit.md:42-44`). A fixed branding record (name, logo asset key, up to N signature labels) is not a designer — but it is the first `doc.image()` in the codebase and the first per-org PDF config. | An accepted ADR says no to the general case; this is the narrow case. Needs an explicit amendment or a recorded "this is not that". |
| **D3** | **Which "attended" definition do school report cards use?** See §2.3(2). | Three existing definitions disagree; picking silently makes report cards contradict the portal or the dashboard. |
| **D4** | **Is #14 Part 2's "merged PDF for printing" a second render pass?** A byte-level merge needs a new runtime dependency (ADR-0009 gate); pdfkit is a writer, not a parser. A second pass over the same data into one document works today. | Confirms no new dependency is requested. |

**Recommendation on each:** D1 → reporting-owned snapshot table, audit references
it. D2 → narrow branding record, record it as explicitly not a designer. D3 →
present+late+excused (matches the roster view teachers already see). D4 → second
render pass. None of these will be implemented against the assignment text without
the owner saying so.

---

## 4. #14 — School Academic Core: plan

**Precondition satisfied:** college net green (§0). `editions: ["school"]` is now
settable (§1.2).

### Part 0 (prerequisite, not in the assignment text) — extract the fast-path

#14 says "reuse the S4 teacher fast-path UX — do NOT build a second marks-entry
pattern". That is impossible today because it is not a component (§2.1). So:

- Extract `apps/web/app/(app)/manage/marks/page.tsx:199-235` (plus `validateScore`
  `:29-35` and `onRowKeyDown` `:97-109`) into a reusable component taking roster,
  values, max, and a save callback.
- **Pure refactor: zero behaviour change.** Guarded by the existing e2e contract
  (`tests/e2e/fast-path.spec.ts:117-148` — `getByRole("spinbutton", {name: /^score for /})`,
  `[aria-live='polite']` matching `\d+/\d+`, `button /save marks/i`) and
  `apps/web/src/ui/marks-page.test.tsx`.

### Part 1 — School assessment model (new module, `editions: ["school"]`)

- New module `packages/modules/school-assessments` (prefix `sca_`), gated to school.
- `sca_terms` — the term entity that does not exist today: name, start/end dates,
  status (`open` | `closed`), per class or per school.
- `sca_assessment_types` — unit test / half-yearly / annual / internal / practical,
  with configurable weightings per term. This is genuinely new; no weighting exists.
- Marks reuse the extracted fast-path component from Part 0.
- Grade derivation reuses `res_grade_scales` + `bandFor` (`results/src/gpa.ts:25-32`).
  **Both marks and derived grade are stored** (#14 requires it) — a departure from
  college, where grades are computed on read and stored nowhere.
- Scope: shared `ScopeChecker` only, via the `marksEnter` template (§2.2). No
  hand-rolled containment. If anything appears to need a security-core edit: **STOP
  and report** (ADR-0012, ADR-0016).

### Part 2 — Report cards

- New report kind through the existing reporting contract. The full checklist a new
  kind must satisfy is six steps including **two** duplicated literal lists and a
  migration — see §2.2 and the grade-card precedent.
- A `SchoolReportCardSource` injected via `ReportSources`, exactly mirroring
  `createGradeCardSource`.
- Batch generation: BullMQ job + **progress by counter column** (the platform has no
  progress channel — §2.1), reusing the CSV-import pattern.
- Merged PDF = second render pass with `addPage()`, per D4.
- Branding per D2. Snapshot per D1.

### Part 3 — Term management

- `open` → `closed` locks marks entry; admin reopen requires an audited reason.
- **Note the asymmetry, deliberately:** this is *not* the college publication
  model. College publication is irreversible and does not lock marks at all
  (§2.3(1)). School terms get a real, reopenable lifecycle. College is untouched.
- Per-term attendance summaries are new aggregation (§2.1). Reusable pieces: the
  `gte`/`lte` predicate in `academics/src/repo/attendance-repo.ts:133-137` and the
  counting shape at `handlers.ts:331-345`. Definition per D3.

### Part 4 — e2e (school suite)

Journeys per the assignment, into `tests/e2e/school/`. Before that suite can be
trusted, triage the 76 shared journeys against a school server — two are already
known to need it (`help.spec.ts`: zero school help docs; `import.spec.ts`: columns
differ per ADR-0023). Recorded in `tests/e2e/school/README.md`.

Containment probes for every new route, mutation-verified to the #11.5 standard
(remove check → observe red → restore).

---

## 5. #15 — School Operations: plan

**Part 1 — Parent linkage.** `sch_guardians` linked to students; multiple per
student, exactly one primary. Notices to "parents of Standard 8B" use the notices
module's existing `orgOverlaps` **audience-matching** path — explicitly NOT the
containment checker (ADR-0022 is real and says exactly this;
`notices/src/handlers.ts:36-41`). CSV/PDF contact export per section. **No SMS
gateway** — paid dependency, v2 decision, per the assignment.

**Part 2 — Compliance fields.** Category, RTE flag, Aadhaar-linked student id
(stored, never a login identifier), mother tongue, previous school, TC number.
Edition-gated: must not appear on college student forms. Plus an RTE-by-category
-and-standard PDF report. Fields and a report — no workflow.

**Part 3 — Promotion workflow.** Standard N → N+1 per section with per-student
exceptions. **Status-only transitions, never hard-delete** — consistent with the
platform rule and with `ON DELETE RESTRICT` throughout the org tree (ADR-0014).
Dry-run preview must match the committed result; the commit is one audited
transaction. TC generation for leavers.

**Part 4 — e2e** as specified, containment probes mutation-verified.

---

## 6. Sequencing

1. ~~#13~~ **done**, college net green.
2. **D1–D4 answered** (§3). D1 and D2 block #14 Part 2 specifically; Parts 0/1/3 can
   proceed without them.
3. #14 Part 0 (fast-path extraction) — unblocked, pure refactor, start here.
4. #14 Parts 1 → 3 → 2 (Part 2 last; it carries both open decisions).
5. #14 Part 4, then triage the shared e2e specs against a school server.
6. #15 Parts 1 → 2 → 3 → 4.

**Re-run the college suite after every part**, not once at the end. It is the only
evidence that "college behaviour provably unchanged" is true, and the recipe for
running it is non-obvious enough that it had gone unrun for two days.

---

## 7. Carried-over debt, not in #13/#14/#15 scope

- **No admin UI for the audit log.** The route exists; nothing renders it. Clock
  rollbacks and seat overages are recorded and then unreadable without SQL.
- **`{message}` vs `problemSchema` response mismatch** — 84 occurrences across all
  15 modules. Pre-existing, mechanical, deferred three times.
- **#12 Part 5** — clean-server install, still blocked on an owner-issued licence
  token plus an image rebuild.
- **Vendor-side licensing operations** — no record of what was issued to whom, no
  renewal/expiry tracking, no reissue workflow. Verifier done; business process not
  specced.
- **`content/help/school/`** — 15 docs to author before a school install ships with
  usable help.
- The four §2.3 findings.
