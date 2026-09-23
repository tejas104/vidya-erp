# Vidya delivery roadmap

Maintained by the Vidya product/implementation owner. Revised as evidence
changes — this is a living record, not a plan written once.

- Branch: `codex/claude-school-product`
- Worktree: `D:\ATLAS\.worktrees\claude-school-product`
- Base: `a9d5fc16f075b86474050fbefd4f0860ac21f006` (gate-04 reviewed checkpoint)
- Integration commit: `0ddf80cc3ab8ff1ecc1b663fd0e6d152badeb161`
- Last revised: 2026-09-23

Companion documents: [COMPETITIVE-PARITY-MATRIX.md](COMPETITIVE-PARITY-MATRIX.md),
`DELIVERY-AND-REVIEW-REQUIREMENTS.md`, `VIDYA-SCHOOL-FIRST-SAAS-PLAN.md`.

## Status legend

`DONE` · `IN PROGRESS` · `BLOCKED` · `NEXT` · `PLANNED` · `DEFERRED`

A slice is `DONE` only against the 12-point Definition of Done in the owner
brief. Schema alone, backend alone, UI alone or a document alone is not `DONE`.

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
| 1.1 | **Immutable school report-card backend** | **IN PROGRESS** | Active slice. Frontend contract already pinned by `SchoolReportCardsPage`. |
| 1.2 | Live school browser proof | `NEXT` | Harness exists (`a05598d`: `docker-compose.school-e2e.yml`, `scripts/school-e2e.ts`). Gate-04 recorded that no live run has ever been executed. Must not be claimed until run. |
| 1.3 | Guardian identity + authorization ADR | `BLOCKED → design` | Gate-04: needs an ADR covering authentication shape, relationship revocation, policy defaults and the identity/people boundary **before** implementation. Hard blocker for 1.4. |
| 1.4 | Parent portal essentials | `PLANNED` | Depends on 1.3. Reuse `portal` (`ptl_`) read models behind a guardian resolver — do not fork a parent module. |
| 1.5 | Promotion / detention / transfer | `PLANNED` | Auditable batch with preview; reversible per student; no hard delete of enrollment history. |
| 1.6 | Certificates (TC, bonafide) | `PLANNED` | Generated from record state, numbered and audited — not free-text templates. |
| 1.7 | Bulk marks import | `PLANNED` | Reuse the people-import dry-run + downloadable error-report pattern. |
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

---

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

All `PLANNED`. None started.

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
| **Guardian identity** — authentication shape, revocation semantics and the identity/people boundary are undecided. Blocks every parent surface. | High | Open. ADR required before any implementation. |
| **No live browser evidence has ever been executed** for school journeys. The harness exists; a listed Playwright test is not a pass. | High | Open. Gate-04 named this a release-evidence item, not polish. |
| **No SaaS control plane exists.** The product is not sellable as SaaS until Phase 3. | High | Open, scheduled Phase 3. |
| **Integration suite shares Redis with the owner's running stack**, causing a false failure in the BullMQ test. | Low | Diagnosed; mitigated with a dedicated Redis db index. Recorded above. |
| **Help coverage is thin** — 26 school screens and 16 college screens have no help doc. | Medium | Open; closed incrementally per slice. |
| **No validation with real school users yet.** Every competitive row is `Unvalidated`. | High | Open. Parity claims must not be made until this changes. |
| Medical/health data is advertised by the benchmark but has no privacy gating in Vidya. | Medium | Correctly deferred until gating exists. |
