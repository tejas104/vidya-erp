# Assignment #10 · S2a (nav + breadcrumbs + global search) — Verification Evidence

Branch: `feat/assignment-10-ui-overhaul` · S2a range: `85dacca..HEAD` (9 task commits)
Sub-project S2a of the S2 split (S2b = screen migration). Presentation/nav only.

## 1. Full e2e — GREEN (nav regroup broke nothing)
Fresh prod build + worker, `PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e`:
```
18 passed (33.4s)
[route-coverage] 142 RouteSpecs across 15 modules; 0 missing files; 0 returned 404
```
Every journey still navigates the regrouped sidebar — incl. **J6 accountant → Reports via nav** (Reports label/href unchanged; groups default-EXPANDED so nothing is hidden). The regroup changed group headers only, not labels or hrefs.

## 2. Unit/UI tests — green
`pnpm test:ui` → **160 passed**; `pnpm --filter @vidya/web typecheck` → clean.
New tests: navConfig order/omit/crumbsFor, sidebar collapse+persist+labels, Breadcrumbs, mapPool, searchIndex (incl. PII-leak + role-keyed cache + cache), SearchPalette (filter/navigate/empty/page + Retry-no-double-fire), shell Cmd-K.

## 3. No ad-hoc styling — gate green
`node scripts/check-no-adhoc-hex.mjs` → **`no ad-hoc color literals ✓`**. All new component CSS (Breadcrumbs, SearchPalette) is token-only; the minimal sidebar/search shell CSS added to globals.css is token-only too.

## 4. Zero backend changes (hard constraint)
```
git diff --stat 85dacca..HEAD -- '**/handlers/**' '**/schema/**' '**/migrations/**' 'packages/platform/src/auth/**'
→ (empty)
```

## 5. PII boundary — enforced + proven
`searchIndex` projects each `StudentView` (which includes `phone/guardianName/guardianPhone/dob`) to `{ name, roll, section, href }` only. A test serializes the built index and asserts none of the PII values appear. The only `phone/guardian/dob` reference in `apps/web/src/ui/search/*.ts` is the test's negative-control fixture; production `searchIndex.ts` references them only in the boundary comment.

## 6. Scope-safety
Global search is only as broad as the caller's own scoped endpoints return (a teacher's `collegeTree`/`sectionRoster` are server-scoped; pages are role-filtered via `NAV`). No client-side role bypass. Session cache is keyed on roles (a role change re-fetches).

## 7. Screenshots (attached)
- `s2a-sidebar-1280.png` / `s2a-sidebar-360.png` — 7-domain regroup with human labels, PEOPLE collapsed (chevron) beside expanded groups, Dashboard ungrouped at top, "Search… ⌘K" box in the header.
- `s2a-search-1280.png` / `s2a-search-360.png` — the Cmd-K SearchPalette open mid-query.

## What S2a delivered
- Sidebar regrouped into the 7 task-domains (PEOPLE/ACADEMICS/FEES/COMMUNICATION/REPORTS/ADMINISTRATION + ungrouped top); collapsible, default-expanded, per-group persisted; human labels single-sourced via `domainLabel`.
- Derived **breadcrumbs** (`crumbsFor` from the same `NAV`), rendered shell-level.
- **Cmd-K global search** (+ header box) over a scope-safe, PII-safe, pooled, cached prefetch index of **students + pages**.

## Findings recorded (STOP-and-report; not worked around)
- **No `students?q=` endpoint** → client prefetch index, O(sections) first-open (pooled 6). Scheduled: #11 rider.
- **No teachers-list endpoint** → staff search dropped from S2a. Scheduled: #11 rider.
- **No "edition" concept** → nav keys off roles only (editions N/A).
- A student result routes to the full-page profile `/students/[id]`; the SlideOver upgrade is S2b.

## Deferred to S2b / final review
Migrating the 27 screens onto primitives + loading/error/empty states + student SlideOver-from-tables + the raw-px/scale gate. Task-level Minors are collected in `.superpowers/sdd/progress.md` and the per-task reviews for the final whole-branch triage.
