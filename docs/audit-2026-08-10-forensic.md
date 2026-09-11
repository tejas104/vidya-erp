# VIDYA ERP — FULL FORENSIC AUDIT (post-#10/#11)

**Date:** 2026-08-10 · **Branch:** `feat/a11-onboarding-import` @ `d79d055`
**Audited range:** `d1779e9..d79d055` — 27 commits, 128 files, +5601 / −386

**Method.** Verified against actual code and actual command output only. Plan documents, assignment specs, design docs, SDD ledgers and evidence bundles were treated as inadmissible and were not consulted. Nothing was changed.

**Environment constraint governing the whole audit.** Docker Desktop is DOWN — `docker ps` hangs past 120s. Postgres, Redis and MinIO are unavailable; the app is not served. Every check needing a live database, real HTTP, or the running app is **UNVERIFIED**, marked as such throughout, and enumerated with remedies in §5.

**Completeness.** This audit is **partial**. Four parallel audit agents were terminated by an account session limit; the evidence below is what was gathered and verified directly. Parts B and D are complete. Part A's checks 2 (UI reachability), 5 (per-module test counts) and 6 (seed realism) were **NOT AUDITED** — recorded as such in the scorecard rather than guessed.

---

## 1. PER-MODULE SCORECARD

Six checks: **R**=Routes · **U**=UI reachability · **D**=DB/migrations · **S**=Scope · **T**=Tests · **Sd**=Seed

Legend: **PASS** · **PARTIAL** · **FAIL** · **UNVER** (blocked, see §5) · **N/A** (not audited)

| Module | R | U | D | S | T | Sd |
|---|---|---|---|---|---|---|
| academics | PASS | N/A | PASS | PASS | UNVER | N/A |
| analytics | PASS | N/A | PASS | PASS³ | UNVER | N/A |
| coursework | PASS | N/A | PASS | PASS | UNVER | N/A |
| exams | PASS | N/A | PASS | **PARTIAL**⁴ | UNVER | N/A |
| fees | PASS | N/A | PASS | PASS | UNVER | N/A |
| identity | PASS | N/A | PASS | PASS | UNVER | N/A |
| leave | PASS | N/A | PASS | **PARTIAL**⁵ | UNVER | N/A |
| notices | PASS | N/A | PASS | **PARTIAL**⁴ | UNVER | N/A |
| people | PASS | N/A | PASS | PASS | UNVER | N/A |
| portal | PASS | N/A | PASS | PASS¹ | UNVER | N/A |
| reporting | PASS | N/A | PASS | PASS | UNVER | N/A |
| results | PASS | N/A | PASS | **PARTIAL**⁴ | UNVER | N/A |
| syllabus | PASS | N/A | PASS | PASS | UNVER | N/A |
| system | PASS | N/A | PASS | PASS² | UNVER | N/A |
| timetable | PASS | N/A | PASS | PASS | UNVER | N/A |

> **S column corrected 2026-08-10** after reading every handler directly. The prior revision graded from a grep of `handlers.ts` only and was wrong: it marked `leave` FAIL (it is scoped, just hand-rolled) and `analytics` PARTIAL (it uses the shared checker, in `aggregation-scope.ts`). See §4.1.

**Column meanings and why each verdict was given.**

- **R (Routes) = PASS for all 15.** Structural only: 149 declared RouteSpecs, 131 `route.ts` files (files exporting multiple methods account for the difference), and `scripts/route-coverage.test.ts` asserts every spec has a file — it passes. **Live HTTP status per endpoint is UNVERIFIED (Docker down)**, so "PASS" here means *the route file exists*, not *the endpoint responds*.
- **U (UI reachability) = N/A for all 15.** Not audited. Per-route sidebar reachability and dead-in-UI route identification were not performed.
- **D (DB) = PASS for all 15.** Every `migrations/*.sql` has a matching `.down.sql`; zero orphans across all modules. **Running up/down against a scratch database is UNVERIFIED (Docker down)**, and per-migration reversal *semantics* were not individually compared.
- **S (Scope)** — the only column with real differentiation; see §4.1 for the full finding.
- **T (Tests) = UNVER for all 15.** Aggregate unit+ui is measured and green (963/963), but **per-module counts and measured coverage were not gathered**; integration and e2e are Docker-blocked. Configured coverage thresholds are *not* measured coverage and are not reported as such.
- **Sd (Seed) = N/A for all 15.** `scripts/seed-demo.ts` was not read for per-module data realism.

¹ `portal` is `STUDENT_ONLY` and self-scopes on the principal — no grant check needed.
² `system` scopes preferences on `principal.id` with no request-supplied id (composite PK `(userId, key)`); its other routes are health/ready/metrics. Stronger than a grant check, not weaker.
³ `analytics` uses the shared `ScopeChecker` in `src/aggregation-scope.ts` and `src/service/query-service.ts` — not in `handlers.ts`, which is why the first pass missed it.
⁴ Containment enforced, but **hand-rolled** as a local `inCollege()` and college-level only — no department/class/section narrowing.
⁵ Containment enforced (self-scoping + grant filtering), but **hand-rolled**, and the local `covers()` carries a latent privilege escalation plus a multi-college truncation bug. See §3 rows 1–3.

---

## 2. VERIFIED DONE

Each item below rests on a command output or a file read, cited.

1. **Security core untouched by automated work.** `packages/modules/identity/src/core/` has 7 commits, **all authored by `Tejas104`** — no agent-authored change to `PasswordHasher`, `SessionManager` or `ScopeChecker`.
2. **Route coverage complete, structurally.** 149/149 RouteSpecs have a route file; `route-coverage` unit test passes.
3. **The three-times-repeated missing-route bug is now catchable without infrastructure.** The RouteSpec↔`route.ts` existence check lives in `scripts/route-coverage.test.ts` and runs in seconds with no build, compose stack or worker. Previously it existed only inside the e2e suite.
4. **CI is a genuine merge gate.** `.github/workflows/ci.yml` runs Typecheck → Lint (incl. Constitution boundary rules) → no-deferred-work-markers → Unit tests with coverage gate → Integration (Postgres + Redis + BullMQ) → Next production build → **E2E (real browser + HTTP through the App Router)**, with Playwright report on failure.
5. **Style enforcement is a CI lint rule, not a one-time grep.** `package.json:19` — `"lint": "eslint . && pnpm check:styles"`; CI runs `pnpm lint`. Both gates pass: `no ad-hoc color literals ✓`, `spacing/type on-scale ✓`.
6. **Legacy global stylesheet fully retired.** **0 of 30** app pages import it.
7. **Migration pairing complete.** Every up-migration has a down; no orphans in any module.
8. **Unit + UI suite green.** 137 files, **963 tests, 963 passed, 0 failed.**
9. **Negative scope matrix exists and drives direct HTTP.** `tests/e2e/negative-scope.spec.ts` covers **9 role keys** (admin, principal, hod, teacher, teacherOther, classTeacher, classTeacherOther, student, accountant), each asserting **403** via `apiSession` + `ctx.fetch` — not hidden-UI checks. Plus one containment guard (admin 200 / student 403) on `timetable.periods-get`.
10. **Service worker does not cache API responses.** `apps/web/public/sw.js:26` is GET-only; `:32` returns early for anything under `/api/` before any cache logic.
11. **CSV import idempotency.** Duplicate admission numbers are hard row-level errors, never silent updates; re-upload creates zero duplicates. Guarded by `tests/e2e/import.spec.ts`.
12. **Credential sheet is never persisted.** Generated synchronously in the request handler and streamed as `application/pdf`; no object-storage write on that path.
13. **#11 STOP condition resolved by relocation, not by a silent workaround.** The temp-password generator sits in `packages/platform/src/credentials/temp-password.ts`, **outside** the human-owned core; `PasswordHasher` was not modified (see item 1).
14. **Help system shipped.** 15 docs under `content/help/college/`; 19 screens wired with the help affordance (4 wired without docs render a "no help yet" state).
15. **TLS/Caddy prod overlay present.** `Caddyfile` with three cert modes; HSTS opt-in and correctly absent under self-signed.

---

## 3. INCOMPLETE

Each with the specific gap and the file or function that shows it.

| # | Item | Gap | File / function |
|---|---|---|---|
| 1 | **`leave.decide` latent privilege escalation** | `covers()` infers college-wide authority from a **missing** `departmentId`; `OrgPath` permits `{collegeId, classId, sectionId}` with none, so a section-scoped grant reads as college-wide. Latent only because grant derivation always sets `departmentId` | `leave/src/handlers.ts:22-28` (`covers`) · `platform/src/auth/types.ts:24-29` (`OrgPath`) |
| 2 | **`leave.pending-for-me` multi-college truncation** | Reads `principal.grants[0]?.org.collegeId` — only the first grant's college. A multi-college principal silently sees one college's pending requests | `leave/src/handlers.ts:103` (`pendingForMe`) |
| 3 | **`leave` hand-rolls containment** | Scoped, but via a local `covers()` rather than the shared checker | `leave/src/handlers.ts:22-28` |
| 4 | **`exams` / `results` / `notices` hand-roll containment** | Each defines a local `inCollege()` = "caller holds any grant in this college". College-level only; no department/class/section narrowing | `exams/src/handlers.ts:21` · `results/src/handlers.ts:31` · `notices/src/handlers.ts:34` |
| 5 | **`exams.class-schedule` college-wide read** | `ANY_AUTHENTICATED` + `inCollege` only, so any authenticated college member reads any class's exam schedule | `exams/src/definition.ts:143-149` · `exams/src/handlers.ts` |
| 6 | **Negative matrix proves role gates, not containment** | All 9 cases assert a role is denied a route it may not call. **None** asserts a permitted role denied another record on a route it *may* call | `tests/e2e/negative-scope.spec.ts:8-10` (states this itself) |
| 7 | **Cross-college containment untestable on this seed** | The one containment test concedes a true cross-college denial "needs a second college the single-college demo seed does not provide" | `tests/e2e/negative-scope.spec.ts:48-53` |
| 8 | **Force-change-on-first-login** | Does not exist. Login rejects `must_reset` outright, so issued accounts end `active` with no forced change | `auth-service.ts:178` (reject) · `auth-service.ts:246` (documents it cannot be forced) |
| 9 | **License verification at boot** | **ABSENT.** No license check anywhere in the repo — no expiry, no enforcement, no author to attribute | repo-wide; only `next.config.ts` and generated help content mention the word |
| 10 | **`fast-path.spec.ts` A1 permanently red** | Acceptance regex does not match the Now screen's real empty-state copy `"Nothing on your timetable today."` | `tests/e2e/fast-path.spec.ts:66-68` vs `apps/web/app/(app)/manage/now/page.tsx:45` |
| 11 | **navConfig role coverage** | 6 role literals present (admin, principal, hod, teacher, student, accountant); `classTeacher` is not a literal — contextual/grant-driven, path not traced | `apps/web/src/ui/navConfig.ts` |
| 12 | **Orphaned help doc** | `content/help/college/system.md` is committed but `apps/web/app/(app)/manage/system/` has never existed in git history, so no committed screen produces that slug | `content/help/college/system.md` |
| 13 | **Restore drill never executed** | `backup.sh` / `restore.sh` exist; no drill with matching row counts was run | `scripts/backup.sh` · `scripts/restore.sh` |
| 14 | **e2e guards (c) and (d)** | Written and committed, **never executed** | `tests/e2e/help.spec.ts` · `tests/e2e/onboarding.spec.ts` |

---

## 4. CROSS-CUTTING FINDINGS, RANKED BY SEVERITY

### 4.1 — SEVERITY 1: Four modules hand-roll containment instead of using the shared ScopeChecker, and the control meant to catch that cannot see it

> **CORRECTED 2026-08-10 after reading every handler directly.** An earlier revision of this section claimed seven modules had "zero `scopeChecker` reference" and that `leave` had *no record-level scoping at all*. **Both claims were wrong**, and wrong because of a bad method: the grep covered only each module's `handlers.ts`, so scoping that lives in a dedicated file (`analytics/src/aggregation-scope.ts`, `timetable/src/read-model.ts`) was invisible. The corrected findings below come from reading the handler source.

**Corrected enforcement map** (grep across each module's whole `src`, excluding tests):

| Enforcement | Modules |
|---|---|
| **Uses the shared ScopeChecker** | academics, analytics, coursework, fees, identity, people, reporting, syllabus, timetable (**9**) |
| Legitimately exempt — self-scoped on `principal.id` | portal (`STUDENT_ONLY`), system (preferences keyed `(userId, key)`; rest is health/ready/metrics) (**2**) |
| **Hand-rolls containment** | **leave, exams, results, notices (4)** |

**`analytics` is properly scoped** — confirmed: `packages/modules/analytics/src/aggregation-scope.ts:1` imports `ScopeChecker` from `@vidya/platform`, and scoping also appears in `service/query-service.ts`. It never belonged on a suspect list.

**What the four hand-rollers actually do — they are not unscoped:**

- **`leave`** (`packages/modules/leave/src/handlers.ts`): `apply` and `my-requests` self-scope by resolving the teacher from `principal.id` (`:59`, `:94`) — a caller cannot act for or read another teacher. `pending-for-me` filters on the caller's own grants (`:103-111`). `decide` calls a local `covers()` (`:124`) and refuses self-decision (`:121-123`). Genuinely scoped, just not via the shared checker.
- **`exams`** (`:21`), **`results`** (`:31`), **`notices`** (`:34`): each defines a local `inCollege(principal, collegeId)` = `principal.grants.some(g => g.org.collegeId === collegeId)` and gates on it.

**The two real defects this reading found:**

**(a) Latent privilege escalation in `leave.decide`.** `covers()` (`leave/src/handlers.ts:22-28`) infers *college-wide authority from the absence of `departmentId`*:
```ts
if (grant.org.departmentId === undefined) return true; // college-wide (principal/admin)
```
But `OrgPath` (`packages/platform/src/auth/types.ts:24-29`) is `{ collegeId, departmentId?, classId?, sectionId? }` — the narrower fields are **independent** of `departmentId`. A grant shaped `{collegeId, classId, sectionId}` with no `departmentId` therefore reads as college-wide, letting a section-scoped holder approve or reject **any leave request in the college**, including other departments' and HODs'.

Currently **latent, not live**: the grant-derivation seam always populates `departmentId` for class-level grants (`people/src/service/assignments-service.ts:47-51`). It is one directly-created or future grant shape away from becoming live. This is precisely the inference the shared ScopeChecker exists to centralise — `covers()` re-derived containment by hand and got the direction of the inference backwards.

**(b) Multi-college truncation in `leave.pending-for-me`.** `packages/modules/leave/src/handlers.ts:103` reads `principal.grants[0]?.org.collegeId` — **only the first grant's college**. A principal holding grants in more than one college silently sees pending requests for one of them. Wrong results, no error.

**Coarseness, separate from the defects:** `inCollege` is college-level only, so on `ANY_AUTHENTICATED` routes it admits any authenticated member of that college. In practice the exposure is small — `notices` has exactly one such route (`notices.visible`), and it additionally filters by the caller's own grants (`:121`); `exams` has one (`exams.class-schedule`), exposing exam timetables college-wide. `results` routes are all ADMIN_ONLY/STUDENT_ONLY.

**Why this still ranks first.** Not because the app is wide open — it is not. Because containment logic is **duplicated across four modules, divergent, and unreviewed**, one copy has a latent escalation and another a wrong-results bug, and **the e2e suite structurally cannot detect any of it**: `tests/e2e/negative-scope.spec.ts:8-10` states in its own comment that its 9 cases are *"route-level role-gate denials: the pipeline authorizes before it ever looks at a resource."* Every case asserts a role is denied a route it may not call. **None** asserts a permitted role is denied another record on a route it *may* call. So a containment regression in any module lands green.

### 4.2 — SEVERITY 2: The missing-`route.ts` failure mode shipped three times

`identity.account-unlock` (#10.5) and both #11 credential endpoints all shipped with a RouteSpec, a handler and passing unit tests, while 404ing in production — because unit tests call handlers directly and never touch the router. Each was caught only by `route-coverage`, which until this branch lived solely inside the e2e suite and needed a prod build, compose stack and worker to run.

Now mitigated (§2.3): the filesystem half is a zero-infrastructure unit test. Ranked second because the recurrence rate was high and the detection cost was high, but the fix has landed.

### 4.3 — SEVERITY 3: `NODE_ENV=development` in `.env` silently breaks the production build

Sourcing `.env` before `next build` makes Next emit a dev-mode React build; prerendering `/manage/marks` then dies with `Cannot read properties of null (reading 'useContext')`. Established by single-variable test: `.env` sourced + `NODE_ENV=production` → exit 0; `.env` sourced alone → exit 1; no `.env` → exit 0. The failure is loud but its cause is not, and it cost significant time during this work. CI or any operator following a "source .env first" habit can hit it.

### 4.4 — SEVERITY 4: Multi-college username collisions fail silently

Usernames are globally unique; admission numbers are unique only per college; usernames derive from admission numbers. Two colleges both using `2024001` collide, and the loser is skipped from credential issuance. Now at least *visible* on the credential sheet, but the underlying scheme is unresolved and is a product decision about multi-tenancy.

### 4.5 — SEVERITY 5: UI test suite is intermittently flaky

1–3 of 208 UI tests fail per run, different tests each time; predates this branch. Confirmed across multiple runs where a clean re-run passed 963/963. It erodes the signal value of "baseline unchanged."

---

## 5. UNVERIFIED — AND WHAT WOULD SETTLE EACH

| # | Unverified item | Reason | Evidence that would settle it |
|---|---|---|---|
| 1 | Live HTTP status per endpoint (all 149) | Docker down; app not served | Docker up → `pnpm --filter @vidya/web build` → `next start -p 3001` → curl each route, record status |
| 2 | Migration up **and** down on a scratch database | Docker down; no Postgres | Docker up → create throwaway DB → `npx tsx scripts/migrate.ts up`, then down, per migration, recording both outcomes |
| 3 | Integration test results | Docker down (needs Postgres + Redis + BullMQ) | Docker up → `pnpm test:integration` |
| 4 | E2E test results | Docker down; needs prod build + compose + worker | Docker up → `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e` |
| 5 | e2e guards (c) help and (d) onboarding | Written, never executed | Same as #4 |
| 6 | Restore drill with matching row counts | Docker down | Docker up → backup → drop → restore → compare row counts per table |
| 7 | Security headers in a **served** response | App not served (header *configuration* is verified in `next.config.ts`) | App up → `curl -I` on a page and an API route |
| 8 | Measured per-module coverage | `test:coverage` not run; thresholds are configured, not measured | `pnpm test:coverage` and read the per-module report |
| 9 | Per-module UI reachability / dead routes | Not audited | Cross-reference every RouteSpec against `navConfig.ts` and page call sites |
| 10 | Per-module seed realism | Not audited | Read `scripts/seed-demo.ts` per module; or seed a fresh DB and inspect each screen |
| 11 | `analytics` containment | Read model not read | Read the analytics read model and determine where scope filtering occurs |
| 12 | `classTeacher` nav path | Not traced | Trace contextual nav construction for that grant |
| 13 | Per-migration reversal **semantics** | Only file pairing checked | Read each up/down pair and compare statements |
| 14 | Whether `exams`/`results`/`notices` coarse gates are sufficient | Per-handler analysis not performed | Read each handler and determine whether the role gate alone bounds the records returned |

---

## 6. COMMANDS RUN, WITH OUTPUT TAILS

**Unit + UI**
```
$ npx vitest run --project unit --project ui --reporter=dot
 Test Files  137 passed (137)
      Tests  963 passed (963)
   Duration  67.99s
```

**Route-coverage check**
```
$ npx vitest run --project unit route-coverage
 Test Files  1 passed (1)
      Tests  1 passed (1)

$ grep -rho 'id: "…"' packages/modules/*/src/definition.ts | sort -u | wc -l
149
$ find apps/web/app/api -name "route.ts" | wc -l
131
```

**Hex / style gate**
```
$ pnpm check:styles
$ node scripts/check-no-adhoc-hex.mjs && node scripts/check-scale.mjs
no ad-hoc color literals ✓
spacing/type on-scale ✓

$ grep -nE "check:styles" package.json
19:    "lint": "eslint . && pnpm check:styles",
20:    "check:styles": "node scripts/check-no-adhoc-hex.mjs && node scripts/check-scale.mjs",
```

**Migration pairing (up/down file-level)**
```
$ for d in packages/modules/*/migrations; do  # compare up count vs .down.sql count
(no MISMATCH lines = every up has a down)
```

**Security-core history**
```
$ git log --format='%h %an | %s' -- packages/modules/identity/src/core/
82a7bc0 Tejas104 | flashcard
a8b0def Tejas104 | chore: save local development state and feature updates
65165dc Tejas104 | feat(fees): accountant role + fees module core …
0d94952 Tejas104 | feat(identity): admit the self-scoped student role
4011168 Tejas104 | Wire identity core; ADR-0013 matrix extension …
db586da Tejas104 | Identity security core: human-owned implementations landed
6c4f55c Tejas104 | Vidya #2: identity & access (Fable-owned parts; human core gated)
```

**Scope enforcement per module**
```
$ # checkScope-helper files per module
academics 1 · analytics 0 · coursework 0 · exams 0 · fees 0 · identity 1 · leave 0
notices 0 · people 1 · portal 0 · reporting 1 · results 0 · syllabus 0 · system 0 · timetable 0

$ # direct scopeChecker references in handlers
coursework 5 · fees 3 · syllabus 3 · timetable 3
exams 0 · leave 0 · notices 0 · portal 0 · results 0 · analytics 0 · system 0
```

**Auth posture of the zero-scopeChecker modules**
```
exams     6 ADMIN_ONLY · 2 ANY_AUTHENTICATED · 2 STUDENT_ONLY · 2 rolesAnyOf
leave     5 ANY_AUTHENTICATED
notices   2 ANY_AUTHENTICATED · 1 rolesAnyOf
results   5 ADMIN_ONLY · 2 STUDENT_ONLY · 3 rolesAnyOf
analytics 2 ADMIN_ONLY · 7 ANY_AUTHENTICATED · 1 rolesAnyOf
```

**git diff --stat of the audited range**
```
$ git diff --stat d1779e9..HEAD
 tests/integration/support/harness.ts  |  5 +
 vitest.config.ts                      |  7 +-
 128 files changed, 5601 insertions(+), 386 deletions(-)
```

**Integration tests**
```
NOT RUN — Docker daemon unavailable (docker ps hangs > 120s). See §5 item 3.
```

**E2E tests**
```
NOT RUN — Docker daemon unavailable. See §5 items 4 and 5.
Last observed full run (commit 54ad139): 27 passed / 1 failed —
the failure being fast-path.spec.ts A1 (see §3 item 10).
```

**Migration up/down execution**
```
NOT RUN — Docker daemon unavailable; no Postgres to target. See §5 item 2.
File-level pairing was verified statically (above).
```

**Docker**
```
$ docker ps
(hangs; times out past 120s — the constraint governing this audit)
```
