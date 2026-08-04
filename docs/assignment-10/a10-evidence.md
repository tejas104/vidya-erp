# Assignment #10 remainder (Parts 3–5) — Verification Evidence

Branch `feat/a10-remainder-a105-security`. #10 Parts 1–2 (design system, nav/IA) shipped
earlier on `main`; this branch adds **Parts 3 (PWA), 4 (teacher fast-path), 5 (e2e +
evidence)** plus the A1b analytics screen and ANALYTICS nav group. This document is the
controller's verification bundle: every code change was already committed
(`f36956a..75404c2`) before this pass; here it is *measured* against a running prod build.
The #10.5 security work has its own bundle in `a105-evidence.md`.

Track A (#10) commits: `e0d7ce1` nav ANALYTICS · `94a8831` PWA · `5b34333` analytics
screen · `a88edb3` staff search · `3f94419` Now screen · `c6a4038` attendance thumb-grid ·
`b79c739` marks fast-entry · `137c8be` e2e fast-path. Plus verification-session fixes:
`428687e` (e2e fixtures + fast-path selectors — see §2).

## 1. Presentation-only constraint — HELD (verified, correct method)

#10 is presentation-only: zero changes under `handlers/`, `schema/`, `migrations/`,
`packages/platform/src/auth/`. Verified with the **grep method, not a `'**/handlers/**'`
glob** (that glob matches a *directory* and silently misses the identity `handlers.ts`
*file*):
```
git diff --name-only f36956a..HEAD | grep -Ei "handlers|schema|migrations|/auth/"
→ packages/modules/identity/src/api/handlers.ts
  packages/modules/identity/src/api/handlers.test.ts
```
Both are from `14b6b62` (Track B / #10.5, where backend changes are *required*).
Confirmed each of Track A's eight commits touches **zero** handler/schema/migration/auth
files (`for c in <A-commits>; do git diff --name-only ${c}~1..$c | grep -Ei ...; done`
→ none). #10's own commits are presentation-only.

## 2. Full e2e — 26/26 green (read §5 before treating it as visual proof)

Fresh prod build + compose stack (postgres/redis/minio) + worker + `next start -p 3001`,
then `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e`:
```
  26 passed (2.5m)
[route-coverage] 143 RouteSpecs across 15 modules; 126 distinct route.ts files; 0 missing files; 0 returned 404
```
= 18 pre-existing regression journeys (role-journeys 7 + negative-scope 9 + route-coverage
1 + …) **unchanged and green** + 4 new #10 fast-path journeys + 4 #10.5 security guards.

**This is the first live e2e run on this branch** (the implementation was written but never
run against a running app). It surfaced four defects, all fixed in `428687e`/`412302c` and
recorded in `.superpowers/sdd/a10-a105/infra-fix-report.md`:
- **Rate limiter contaminated the regression suite**: every spec logged in from the same
  "direct" IP bucket, tripping the per-IP login cap (10/min) mid-run. Fixed by giving each
  login context a unique synthetic `X-Forwarded-For` (+ a best-effort per-username Redis
  key reset) in the shared `tests/e2e/support/fixtures.ts` — the exact isolation pattern
  `security.spec.ts` already used. No production behaviour changed.
- **`identity.account-unlock` had no Next route** (`route-coverage` caught it): the
  admin-unlock endpoint documented in SECURITY.md was registered + handled but never
  wired to HTTP. Fixed by `412302c` (see `a105-evidence.md §5`).
- **fast-path A1/A2 selector bugs** in the new spec (`main, body` strict-mode violation;
  `getByLabel(/title/i)` vs the real "Assessment name" label; `textbox` vs the number
  inputs' `spinbutton` role; a max-score fixture gap). Fixed in `428687e`.

The four new fast-path journeys are the **first browser-driven tests of the teacher
screens** — J3 (attendance) and J5 (marks) in `role-journeys.spec.ts` are API-only.

## 3. Unit / UI tests + gates — green at HEAD (per prior verification; not re-run in this pass)

Per the pre-flight record and re-confirmed after the verification-session fixes:
```
vitest --project ui    → 189 passed
vitest --project unit  → 698 passed
pnpm --filter @vidya/web typecheck → clean   (re-run after 428687e)
pnpm check:styles                   → clean   (re-run after 428687e)
```
The fix commits touched only `tests/e2e/*` and one `route.ts`, so the unit/ui counts are
unchanged from HEAD.

## 4. Nav ANALYTICS group (A1) — present

The spec's groups are PEOPLE / ACADEMICS / FEES / COMMUNICATION / REPORTS / **ANALYTICS**
/ ADMINISTRATION. Visible in `a10-analytics-1280.png`: the admin sidebar renders the
ANALYTICS group with the Analytics entry active. TOP (Dashboard/portal) stays ungrouped.

## 5. Screenshots — the load-bearing evidence

Captured against the running prod build with
`PLAYWRIGHT_BASE_URL=http://localhost:3001 npx tsx tests/shots/a10.shots.ts`, at 1280px
and 360px, teacher screens as `demo-teacher-ds` and analytics as `demo-admin` (the shots
script logs in per role). **I opened every image below before writing this row.**

| File (1280 + 360) | Observation |
|---|---|
| `a10-now-*` | Teacher "Now" screen ("Right now"). Renders the **"Your teaching day is done — nothing left to teach today"** state. This is a *legitimate computed state*, not an error or empty-fetch: the seed timetable + the wall clock at capture time put the teacher past their last period. `deriveNow()` has five real states (active / no-timetable / off-day / no-classes / day-done); e2e A1 asserts the screen renders one of them by design (it cannot force "active" without owning the seed clock). At 360px it reflows to the mobile hamburger shell, full-width. *Not captured: the "active period → Mark attendance primary button" state, because the run didn't fall inside a seeded period; the primary-action path is exercised instead by A1 driving the register directly and by the attendance shots below.* |
| `a10-attendance-*` | Attendance thumb-grid (A4). Section "FY BSc Computer Science · A", **14 present / 0 absent**, the real seeded FYCS roster (FYCS-001…-014) as thumb-sized cells with coloured avatars, roll numbers and a ✓, plus "All present" and a single "Save attendance". Everyone starts present — the ≤30s target depends on it. Reflows to full-width thumb targets at 360px. |
| `a10-attendance-marked-*` | Same grid after tapping 3 students absent: **11 present / 3 absent**; the absent cells are filled red with an **✕**, present cells are outlined with a **✓** — the distinction is icon-**and**-fill, never colour alone (the A4 requirement, and it survives greyscale). Holds at 360px. |
| `a10-marks-*` | Marks fast-entry (A4). "Enter marks", Class·subject picker ("FY BSc Computer Science · Data Structures"), the "New assessment" form (Assessment name / Kind / Max score), and a real "Existing assessments" table (Quiz 1, Unit Test 1, Assignment 1, Midterm, Quiz 2…). Form stacks vertically at 360px. |
| `a10-analytics-*` | The A1b analytics screen (admin) split from the dashboard: "Attendance trend" line chart (2026-06→08, real ~90–95% values), "Marks by subject" bars (Operating Systems 83%, Data Structures 82%, … 13 visible), admin-only "Recompute analytics", and the ANALYTICS nav group. Charts render with real seeded data — no skeletons. Reflows at 360px. |

No screenshot shows a 403, an unresolved skeleton, or an empty-because-broken table.

## 6. PWA installability (Part 3) — Lighthouse 1.0 / 100%

`lighthouse@11.7.1 http://localhost:3001/login --only-categories=pwa` (headless Chrome):
PWA category **1.0** — installable-manifest / maskable-icon / splash-screen /
themed-omnibox / viewport / content-width all PASS. Full report:
`docs/assignment-10/a10-lighthouse-pwa.report.html` (+ `.report.json`). The same signals
are asserted black-box by e2e guard A4 (manifest served + valid, 192/512/maskable icons
all resolve, `display:standalone`, `<link rel="manifest">` present). Lighthouse dropped the
PWA category in v12, hence the pinned v11.

## 7. Known open items (recorded, not defects introduced here)

- **Global search staff gap** (A1): `identity.listUsers` is ADMIN_ONLY and no per-teacher
  route exists, so staff results are admin-only and every hit routes to `/manage/teachers`.
  Recorded at the code seam (`searchIndex.ts`) and commit body — closing it needs backend
  work #10 forbids. Carried to the whole-branch review.
- **Search still does O(sections) roster fetches** (pooled at 6) — no `students?q=`
  endpoint exists; the code comment schedules the real fix for #11.
- **`SessionManager` has no per-device TTL seam** — reported, not modified (human-owned).
- **CSP ships report-only** — see `a105-evidence.md §6`; the blocker includes A2's own
  `swScript`.

## 8. Environment notes (this run)

- Prod build: succeeded first attempt, no OOM (free RAM ~3.0 GB). Rebuilt once after the
  verification fixes to compile the new `unlock` route into the standalone build.
- Compose stack healthy; Postgres data volume already carried the demo seed (41 users,
  full FYCS roster, assessments), so no `seed:demo` was needed. Worker running (report
  jobs registered) — required for the report journeys (J2/J6).
- The web env-loader reads `process.env` only and Next loads `.env` from `apps/web/`, so
  the root `.env` must be sourced before `next start` (`set -a; . ./.env; set +a`).
