# S2a — Navigation & IA shell (Assignment #10, Part 2, slice a)

**Status:** design, awaiting review
**Date:** 2026-07-22
**Parent:** Assignment #10 · sub-project **S2a** of the S2 split (S2a = nav + breadcrumbs + global search; S2b = screen migration + loading/error/empty states + student SlideOver-from-tables + raw-px/scale gate). S1 (ui-system foundation, 15 primitives + hex gate) is complete and merged-ready on this branch.

## Precondition & constraint
- Baseline e2e **18/18** green; must stay green. Unit/UI suite (`test:ui`) fully green (149).
- **Presentation/navigation only.** ZERO changes under any module's `handlers/`, `schema/`, `migrations/`, or platform `auth/`. If a UI need seems to require a backend change → STOP and report as a finding.

## Findings (recorded, not worked around)
1. **No "edition" concept exists** in the codebase. The assignment's "nav respects edition tags" is a no-op here; nav keys off **roles only**. Editions are N/A until introduced (not invented in S2a).
2. **No flat/searchable student-list endpoint.** Students are listable only per section (`sectionRoster(sectionId)`), reached via college → tree → sections. True global student search would be cleaner with a scoped `students?q=` list endpoint, but #10 forbids backend changes. **Decision (user-approved): build the client-only prefetch index** below (with a concurrency pool + progressive rendering so it holds at real scale, not just demo scale — see searchIndex). **Scheduled remediation:** the endpoint gap is a rider on **#11** (which already adds people-module endpoints) — a scoped `students?q=` reusing the existing ScopeChecker patterns; recorded in [[erp-roadmap]] so it's scheduled, not left to a rediscovered code comment. Target scale to hold client-side: an admin at a ~1,500-student / ~40-section college (index ≈1,500 trivial entries; the ~40 roster requests are the real cost).
3. **No teachers-list endpoint either** — only `getTeacher(id)` and per-class `assignments`. Staff cannot be listed client-side without walking every class's assignments (O(classes), incomplete — assigned teachers only). **Decision (user-approved): staff search is OUT of S2a.** S2a search = **students + pages only**. A **teachers-list endpoint** is scheduled as a #11 rider alongside `students?q=` (recorded in [[erp-roadmap]]); staff search returns to the palette when it lands.

## Goal
Regroup navigation into the 7 task-domains, add derived breadcrumbs, and add a global search palette (Cmd/Ctrl-K + header box) that jumps to **students and pages** — all client-side against existing scoped endpoints, with no backend changes and the e2e net intact. (Staff search is out of S2a — see finding 3.)

## Decisions (locked with the user)
1. **Search sourcing:** prefetch-on-open in-memory index (walk accessible tree → sections → rosters + teachers + page titles), cached for the session; client-filter with debounce. Scope respected automatically (index = only what the role's endpoints return).
2. **Nav domain mapping** (roles unchanged; server still enforces every action):
   - *(top, ungrouped, first):* Dashboard; My register (student).
   - **PEOPLE:** Students, Teachers, Student directory, Organisation.
   - **ACADEMICS:** My Classes, My Timetable, Attendance, Marks, Coursework, Syllabus, Exams, Timetable, Calendar, Results, Backlogs.
   - **FEES:** Fees.
   - **COMMUNICATION:** Notices.
   - **REPORTS:** Reports.
   - **ADMINISTRATION:** Leave, Users, Import, System.
   - **ANALYTICS:** omitted — no dedicated route (Dashboard is the analytics surface); an empty group is never rendered.
3. **S2a student search result → full-page profile** `/students/[id]`; S2b upgrades it to the SlideOver. Keeps S2a independent of S2b.

## Components (isolated, testable)
- **`apps/web/src/ui/navConfig.ts`** — change each entry's `group` to the 7-domain set above; add an explicit domain **order** (PEOPLE→ACADEMICS→FEES→COMMUNICATION→REPORTS→ADMINISTRATION) so `visibleNav` returns groups in a stable order; keep Dashboard/My-register ungrouped (a sentinel group rendered above the domains). `visibleNav(roles)` signature unchanged; only grouping/order changes. Existing `shell.test`/`structure.test` updated to the new groups.
- **`apps/web/src/ui/Sidebar.tsx`** — render the ungrouped top items, then collapsible domain groups (group header = disclosure button; `aria-expanded`). **All groups default to EXPANDED on first visit; collapse is opt-in and persisted per-group in `localStorage`.** (This is better for non-technical clerks — nothing hidden by default — and it removes the e2e-selector risk entirely: no journey's target can start life inside a collapsed group. See Risks.) Active link keeps its current visible active state.
- **`apps/web/src/ui/Breadcrumbs.tsx`** (new) — pure: `crumbsFor(pathname): {label, href?}[]` derived from the **same `NAV` entries the sidebar renders** — this is a hard single-source rule: crumbs are computed from `NAV` (route → its `group` domain + `label`), never a second hand-maintained map. A page added to `NAV` gets crumbs for free; a renamed group can't disagree with its breadcrumb. (A second parallel map in the implementation is a review-reject.) Rendered into the S1 `PageHeader` breadcrumb slot. No crumb on `/dashboard` (top level).
- **`apps/web/src/ui/search/searchIndex.ts`** (new) — `buildIndex(api, roles, onProgress?): Promise<IndexEntry[]>` where `IndexEntry = { kind: "student"|"page", label, sub?, href, roll?, studentId? }`. **PII boundary — enforce in code:** `sectionRoster` returns full `StudentView` *including phone/guardian/dob*; project each to `{ label: fullName, roll: admissionNo, sub: sectionId, href: '/students/'+id }` ONLY. A comment states `// index entries carry name/roll/section/href only — sectionRoster returns PII (phone, guardian, DoB); never copy those into the index. Adding PII fields requires a deliberate privacy review (session-cached client-memory copy).` Pages from role-filtered `NAV`; students by walking `colleges()` → `collegeTree()` → sections (`tree.departments.flatMap(d => d.classes.flatMap(c => c.sections))`) → `sectionRoster(sectionId)`. **Roster fetches run through a small concurrency pool (≈6 in flight), NOT sequentially** — the difference between ~2s and ~15s first-open at 40 sections — and call `onProgress({ done, total })` as each roster lands so the palette can stream. `filterIndex(entries, q): grouped results` — case-insensitive match on label + roll. Module-level session cache. `// ponytail: O(sections) roster requests on first open, pooled at 6; holds to ~1–2k students. Real fix = scoped students?q= endpoint scheduled on #11 (see spec finding 2).` **No staff** (finding 3).
- **`apps/web/src/ui/search/SearchPalette.tsx`** (new) — built on S1 `Modal`; opens on **Cmd/Ctrl-K** (global key handler in the app shell) and from a **header search box**. On first open: **pages and staff appear instantly** (cheap sources); **students stream in** as rosters land, with a live loading row `Students — loading 12/40 sections` driven by `buildIndex`'s `onProgress`. Debounced (150ms) client filter over whatever's indexed so far. Results grouped **Students / Pages**, ↑/↓/Enter keyboard nav, Esc closes (reuses Modal's focus-trap + overlayStack). Selecting a page → `router.push(href)`; a student → `router.push('/students/[id]')`. (No staff group — finding 3; returns when a teachers-list endpoint lands on #11.) Empty state: EmptyState ("No matches").
- **App shell** (`AppShell.tsx`/layout) — mount the Cmd-K handler + header search box + `SearchPalette` once; render `Breadcrumbs` via PageHeader.

## Data flow
Cmd-K/header-click → open palette → (first time) `buildIndex` from scoped endpoints → cache → user types → debounced `filterIndex` → grouped results → select → client-side navigation. No new network on subsequent opens (cache); no backend endpoints added.

## Error / empty / loading
- Index build failure → palette shows an inline error row with a retry (re-invoke buildIndex); pages (from static NAV) always available even if entity fetch fails.
- Empty query → show page shortcuts (the role's nav) as default suggestions.
- No matches → EmptyState.

## Testing
- **searchIndex** unit test (`apps/web/src/ui/search/*.test.ts`): mocked `api` → asserts pages from NAV are role-filtered; a teacher's index contains only their sections' students and no staff; `filterIndex` matches by name and by roll; cache returns without re-fetch.
- **SearchPalette** ui test: Cmd-K opens; typing filters; ↓+Enter on a page result calls the router; student result routes to `/students/[id]`; error row retries.
- **Sidebar/navConfig**: `visibleNav` returns the 7 domains in order for an admin; collapse toggling; the active group is expanded. Update existing `shell.test`/`structure.test`.
- **Breadcrumbs**: `crumbsFor('/manage/marks')` → `[{label:'Academics'},{label:'Marks'}]`; none for `/dashboard`.
- **Regression:** full `test:ui` green; **e2e 18/18** unchanged (S2a adds shell UI; existing journeys must still pass — nav labels/links they click must remain reachable; verify the journeys' selectors against the regrouped nav).

## Verification (S2a exit criteria)
1. `pnpm -r` on S2a surfaces typechecks clean; `test:ui` green incl. new tests.
2. **e2e 18/18** on a prod build (nav regroup must not break any journey's navigation).
3. Screenshots: sidebar (regrouped, a collapsed + expanded group) and the open SearchPalette at 1280 & 360.
4. `git diff --stat` shows zero changes under any `handlers/`/`schema/`/`migrations/`/platform `auth/`.
5. `check:styles` green (any new CSS is token-only).

## Out of scope (S2b and later)
Migrating the 27 screens onto primitives; loading/error/empty on every list screen; student SlideOver-from-tables (S2a search routes to the full-page profile instead); the raw-px/scale gate; PWA/responsive (S3); teacher fast-path (S4); new e2e journeys incl. the global-search journey (S5 — S2a covers it with unit/ui tests only).

## Risks
- **Existing e2e journeys click nav items by label/role.** The regroup changes group headers, not labels/hrefs. The one silent failure mode — a journey's target starting inside a collapsed group — is **eliminated by the default-EXPANDED decision** (all groups open on first visit; collapse is opt-in/persisted). Still run e2e before closing as the gate; but no expand-then-click helper is needed.
- **First-open prefetch latency** for large colleges (O(sections)). Mitigation: lazy (only on first Cmd-K), **pooled at 6 concurrent**, **progressive** (pages/staff instant, students stream with a `loading X/N sections` row), cached after; `ponytail:` note + the #11-scheduled endpoint fix.
- **Cmd-K global key handler** conflicting with browser/inputs. Mitigation: ignore when focus is in an input except the header search; standard palette conventions.
