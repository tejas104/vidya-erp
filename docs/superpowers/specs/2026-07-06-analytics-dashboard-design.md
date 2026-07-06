# Design — Role-adaptive multi-graph analytics dashboard

- **Date:** 2026-07-06
- **Status:** Draft for review
- **Scope:** Round 1 of a two-round enhancement. This round = the analytics
  dashboard. Round 2 (ERP management/write UIs) is a separate spec, later.

## Context

The web UI today is a thin, read-only slice over a ~60-endpoint scope-checked
backend: `/login`, `/dashboard` ("The Register"), and `/students/[id]`. The
dashboard shows role-adaptive scope tiles (attendance %, marks %, at-risk
count, a register heatmap) plus a "Needs attention" at-risk list. The analytics
read-model already serves richer data than the UI surfaces (node rollups at any
level, monthly time-series, at-risk with reasons, per-section roster
attendance).

## Goal

Turn `/dashboard` into a **richer, multi-graph, role-adaptive analytics
dashboard** optimised for **demo/evaluation impact** — visual variety and
polish — while remaining strictly truthful to the product's disclosure rules
(scope-filtering, constituent-closure, minimum-cohort suppression). Graphs are
**hand-rolled SVG** (extend `charts.tsx`), no chart library, CDN-free — matching
ADR-0009 and the existing "every mark intentional" dataviz approach.

## Non-goals (this round)

- No write/mutation UI (no auth-core changes). Round 2 covers management screens.
- No new chart library / dependency.
- No interactive drill-down navigation or filters (that was Approach C; deferred
  as a possible stretch, not in this spec).
- Marks-distribution histogram at college/department level (see Decisions).

## Decisions (from brainstorming)

1. Analytics dashboard leads; ERP breadth is a separate later spec.
2. Purpose: **demo/evaluation impact** (visual variety + polish, still truthful).
3. Charting: **extend hand-rolled SVG** `charts.tsx`; dataviz-skill-guided.
4. Approach **B**: UI + a few small **read-only** analytics endpoints.
5. **Enrich the demo seeder** so time-series/histograms render full.

## Architecture

### A. Backend — two new read-only endpoints (analytics module)

Both follow the existing read-model → `QueryService` pattern, inheriting
constituent-closure, minimum-cohort suppression, and at-risk field-gating by
construction. No writes; no identity/auth-core changes.

**A1. Comparison — `GET /api/v1/analytics/compare/{level}/{nodeId}`**
Returns a rollup summary for each **child** of the node:
- college → departments, department → classes, class → sections.
- Each child: `{ nodeId, name, attendance: AggState, marks: AggState (overall),
  atRisk: number, cohort: number }`, with per-child `denied` /
  `insufficient-cohort` / `no-data` states preserved (a child outside scope or
  under the cohort floor is withheld, not errored).
- Read-model method `childrenRollups(principal, level, nodeId, ay)`: enumerate
  children via the people directory, then `query.nodeAttendance` /
  `query.nodeMarks` per child (scope-checked). Powers the **comparison bars**.

**Dependency — extend `PeopleDirectory`** (read-only, mirrors the existing
`sectionsOfClass` added "for dashboard tiles"):
- `departmentsOfCollege(collegeId): Promise<{ departmentId; name }[]>`
- `classesOfDepartment(departmentId): Promise<{ classId; name }[]>`
- (reuse existing `sectionsOfClass`)

**A2. Distribution — `GET /api/v1/analytics/distribution/{level}/{nodeId}`**
Returns **server-side histogram buckets** (counts only — never identifiable
rows), gated to ≥ min-cohort:
- Marks bands: 0–40, 40–55, 55–70, 70–85, 85–100 (counts per band).
- Attendance bands: <50, 50–75, 75–90, ≥90 (counts per band).
- **Levels: class and section only** (cohort levels where a histogram is
  meaningful and the roster is enumerable). College/department get the
  comparison bars instead — the correct visualisation at aggregate levels.
- Read-model method `distribution(principal, level, nodeId, ay)`: enumerate the
  node's students (class → sections → rosters), compute each student's
  scope-filtered overall marks / attendance via the existing per-student query,
  bucket the counts. Below min-cohort → `{ state: "insufficient-cohort" }`.

### B. Charts — extend `apps/web/src/ui/charts.tsx`

Hand-rolled SVG, dark-mode via CSS vars, accessible (`role="img"` +
`aria-label` summarising the data), direct-labelled (no colour-only legend),
CDN-free. New primitives:

- `TrendLine` — labelled line + area with one axis and a last-point marker
  (generalises `Sparkline` to a larger titled chart). Attendance/marks over months.
- `CompareBars` — grouped/paired bars per child node (attendance + marks),
  each row direct-labelled with the child name; renders per-child withheld state.
- `Histogram` — vertical bars for distribution bands with count labels.
- `RiskDonut` — at-risk composition (low-attendance / low-marks / both) with a
  centre total; falls back to a stacked bar if a donut reads poorly on paper.

Reuse: `StatTile`, `Sparkline`, `SubjectBars`, `RegisterStrip`, and the
existing `WithheldStat`/`AggState` rendering for empty/withheld/denied states.

### C. `/dashboard` redesign (role-adaptive)

Layout, top to bottom:
1. **KPI row** — attendance YTD · avg marks YTD · at-risk count · cohort size,
   scoped to the caller's top node.
2. **Graph grid** (each graph present only where the caller's scope supports it):
   - Attendance-over-time `TrendLine` (node monthly series).
   - Marks-by-subject `SubjectBars` (node rollups).
   - **Comparison** `CompareBars`: principal → departments, HoD → classes,
     class-teacher → sections. Marquee graph.
   - **Marks `Histogram`** at class/section level.
   - **At-risk `RiskDonut`** beside the existing "Needs attention" list.
   - Register `RegisterStrip` heatmap (class/subject scope).
3. Each graph renders its own designed **withheld / cohort-suppressed / denied /
   empty** state; one hidden graph never blanks the page (partial dashboards are
   normal and expected). Masthead + theme toggle unchanged.

**Role → graph matrix (illustrative):**

| Graph | Principal | HoD | Class teacher | Subject teacher |
|---|---|---|---|---|
| KPI row | college | department | class | subject/class |
| Attendance trend | ✓ | ✓ | ✓ | ✓ |
| Marks by subject | ✓ | ✓ | ✓ | own subject |
| Comparison bars | depts | classes | sections | — (empty state) |
| Marks histogram | — | — | class | — |
| At-risk donut + list | ✓ | ✓ | ✓ | ✓ (gated) |
| Register heatmap | — | — | ✓ | ✓ |

### D. Data flow & error handling

Client (`/dashboard`) → new `api.ts` methods (`compare`, `distribution`) → new
Next route files (`routeHandler("analytics.compare"|"analytics.distribution")`)
→ analytics handlers → read-model → scope-checked `QueryService` → rollups repo
+ people directory. Same-origin, HttpOnly cookie; the UI holds no privileged
path. `401` → redirect to `/login` (existing pattern). Per-graph failures are
contained: `denied` → "outside your scope"; `insufficient-cohort` → "cohort too
small to summarise (under the configured minimum, 5 by default —
`ANALYTICS_MIN_COHORT`)"; `no-data` → "no data yet".

## Seed enrichment (`scripts/seed-demo.ts`)

Extend the demo seeder — still driving the **real** authenticated, scope-checked,
audited chain — so the graphs render full:
- Attendance spanning **~5 months** of school days (not 10 consecutive days),
  so `TrendLine` has a real multi-point series.
- More assessments per subject across those months (marks trend + histogram).
- Larger cohorts (enough students per class to clear the min-cohort floor with
  margin and give the histogram shape).
- Keep it idempotent and non-production-guarded exactly as today; keep the
  designated "struggler" pattern so at-risk stays populated.
- After seeding, `analytics.recompute` must run to rebuild rollups (as now).

## Testing & verification

- **Analytics unit tests**: `childrenRollups` and `distribution` — closure,
  min-cohort suppression, denied/partial paths — mirroring existing
  handler/query tests.
- **People directory unit tests**: `departmentsOfCollege`, `classesOfDepartment`.
- **UI (React Testing Library)**: new dashboard renders each graph from a mocked
  API, shows withheld/denied/empty states, and role variants — following the
  existing `dashboard.test.tsx` / `login.test.tsx` style.
- **Integration** (optional, existing Postgres/Redis suite): hit the two new
  endpoints scope-checked end-to-end.
- **Visual verification**: Playwright drive per role (principal, HoD, class
  teacher, subject teacher) against the enriched seed, screenshot each, confirm
  every graph fills and withheld states read correctly.

## Risks & open questions

- **Distribution enumeration cost**: computing per-student marks by iterating
  rosters is O(students) queries; fine at class/section scale. If it's slow,
  add a batched rollup query later (not needed for v1 demo sizes).
- **Comparison at college level with many departments**: bar count stays small
  for the demo; if a real college had dozens, we'd cap/scroll — out of scope now.
- **Academic-year rollover**: reuse the existing `currentAcademicYear` helper on
  both client and server; the enriched seed must sit inside one AY.

## Sequencing (for the implementation plan)

1. People directory: `departmentsOfCollege`, `classesOfDepartment` (+ tests).
2. Analytics read-model + `compare` and `distribution` endpoints (+ tests).
3. `api.ts` client methods + types.
4. `charts.tsx` new primitives (`TrendLine`, `CompareBars`, `Histogram`,
   `RiskDonut`).
5. `/dashboard` redesign wiring the graphs, role-adaptive, with withheld states.
6. Seed enrichment + recompute.
7. RTL tests + Playwright visual pass per role.
