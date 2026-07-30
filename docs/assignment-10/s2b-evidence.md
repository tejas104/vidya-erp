# Assignment #10 · S2b (screen migration onto @vidya/ui-system) — Verification Evidence

Branch: `feat/assignment-10-ui-overhaul` · S2b range: `aa8f8d5..bf8a62e` (46 commits: 34
migration-task commits + a final whole-branch review + 11 fix commits `d16d518..bf8a62e`
closing all 9 Important findings). Sub-project S2b of the S2 split (S2a = nav +
breadcrumbs + global search, already verified separately).

This is Task V, the closing verification bundle. Every code change for S2b is done —
this document only measures it.

## 1. Full e2e — 18/18, but read this before treating it as visual proof

Fresh prod build (`pnpm --filter @vidya/web build`) + compose stack (postgres/redis/minio)
+ worker + `pnpm --filter @vidya/web start -p 3001`, then:

```
PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e

  18 passed (34.5s)
[route-coverage] 142 RouteSpecs across 15 modules; 125 distinct route.ts files; 0 missing files; 0 returned 404
```

**Read this honestly, not generously.** The final whole-branch review (finding I10)
established that the entire 18-journey suite —
`tests/e2e/{role-journeys,negative-scope,route-coverage}.spec.ts`, 361 lines — contains
exactly **three** DOM touchpoints:

```
getByRole("link", { name: /users/i })      # J1
getByRole("link", { name: /reports/i })    # J6
await expect(page).toHaveURL(/\/portal/)   # J5
```

Everything else is `request.fetch` against the API. A green 18/18 proves the app builds,
boots against a real Postgres/Redis/MinIO stack, and the API/scope layer still works. It
proves **essentially nothing** about how the 25 migrated screens render. Do not read this
section as "the migration was visually verified" — section 6 (screenshots) and the 162
`test:ui` tests are the real regression net for that; see there.

## 2. Unit / UI tests — green (verified by the controller at HEAD `bf8a62e`, not re-run)

```
pnpm exec vitest run --project ui --no-file-parallelism    → 162 passed / 52 files
pnpm exec vitest run --project unit --no-file-parallelism  → 642 passed / 71 files
pnpm --filter @vidya/web typecheck                          → clean
pnpm --filter @vidya/ui-system typecheck                     → clean
```

## 3. Style gates — both green (verified by the controller at HEAD, not re-run)

```
pnpm check:styles   → no ad-hoc color literals ✓ ; scale gate ✓
```

## 4. Zero backend changes (hard constraint, verified by the controller at HEAD)

```
git diff --stat aa8f8d5..HEAD -- '**/handlers/**' '**/schema/**' '**/migrations/**' 'packages/platform/src/auth/**'
→ (empty)
```

## 5. Legacy-primitive grep — accurate, not a blanket claim

```
grep -rn '@/ui/\(Button\|Field\|DataTable\|Card\|Modal\|ConfirmDialog\|RingStat\|Tabs\)"' apps/web/app
→ no matches
```

This does **not** mean "no legacy imports remain." Three legacy primitives still have
real imports, by design:

- `Skeleton` — pinned by `app/(app)/layout.tsx`
- `Badge` and `EmptyState` — pinned by `src/ui/Noticeboard.tsx`

Both consumers are out of scope for S2b. Legacy `PageHeader` was the one survivor that
was *not* correctly pinned (final review I7 — the working-tree grep during migration
missed that the only remaining reference was the owner's untracked `/manage/system`
page, not a committed one); it and the dead `/manage/system` nav entry were deleted in
`7dd1122`.

## 6. Screenshots — the load-bearing evidence

Captured against the running prod build with `PLAYWRIGHT_BASE_URL=http://localhost:3001
npx tsx tests/shots/s2b.shots.ts`: one migrated screen per task-domain at 1280px and
360px, the `StudentSlideOver` at both viewports plus a dark-mode shot, and an attempted
fee-receipt print shot. **I opened every image below before writing this row.**

| File | Observation |
|---|---|
| `s2b-students-1280.png` / `-360.png` | Students table (PEOPLE domain) renders correctly at both widths: section picker, admission no./name/status columns, row actions (View/Edit/Link sign-in/Transfer) all present. Status dropdown shows a real `Backlog (ATKT)` value on one row. |
| `s2b-attendance-1280.png` / `-360.png` | Renders a `DeniedState` — "No sections you can record for. Open a period from your Today card to mark its attendance." **This is expected, not a defect**: the shots are all taken as `demo-admin`, who (correctly) has no teaching assignment to record against. Functional attendance recording is covered elsewhere (unit/integration + e2e J3 as a real teacher). |
| `s2b-results-1280.png` / `-360.png` | "The marksheet desk" (RECORDS domain) — grade scales, subject-credits picker, compile/publish panel all render with real seeded data (10-point scale "in use"). |
| `s2b-fees-1280.png` / `-360.png` | Fee counter (FEES domain) — Counter/Setup/Collections tabs, section + student-search inputs, and an "Outstanding dues" table with real seeded rupee amounts. The `DUES` column reads flush-right against the table edge, consistent with the I1 fix (ui-system `Table` `align="right"` restored) having landed. |
| `s2b-notices-1280.png` / `-360.png` | Noticeboard (COMMUNICATION domain) — real seeded notices (Term 1 exams, Ganesh Chaturthi, Annual Sports Day, …) with audience/created/publish/status columns and working Delete buttons. |
| `s2b-reports-1280.png` / `-360.png` | Reports (REPORTS domain) — the Generate panel (type/section/student/format) plus a table of real completed `hall-ticket` report rows with Download actions. |
| `s2b-users-1280.png` / `-360.png` | Sign-ins & access (ADMINISTRATION domain) — real seeded accounts (`demo-accountant`, `demo-admin`, `demo-ct-fybcom`, …) with roles/status/grants and per-row Reset/Set password/Disable actions. |
| `s2b-portal-1280.png` / `-360.png` | **Shows an error state**: "Couldn't load your register. Try again shortly." This is `portal.me` correctly 403-ing — the portal API is `STUDENT_ONLY` by definition (`packages/modules/portal/src/definition.ts:22`) and every shot in this run authenticates once as `demo-admin`, who is not a student. **This is the expected access-denial render for the wrong role, not a broken portal screen** — but it also means this screenshot does *not* show what a student actually sees. The one piece of evidence that the portal UI itself renders correctly for its real audience is e2e J5 ("student portal surfaces every self-scoped view"), which passed, and the `test:ui` portal-page tests. Flagging this gap honestly rather than presenting an error screenshot as a working-UI screenshot. |
| `s2b-slideover-1280.png` | `StudentSlideOver` open over `/manage/students` (row "View"): header, avatar ("AV" on a brand-blue gradient with **light** text), Overview/Attendance/Marks/Fees tabs, Status card, class-teacher-view guardian/phone/DOB block with the "admin only" field-lock notice, status-change control. |
| `s2b-slideover-360.png` | Same SlideOver content reflows correctly full-width on a 360px viewport (it becomes the whole screen, table beneath is not visible — expected). |
| `s2b-slideover-dark-1280.png` | Same SlideOver under `prefers-color-scheme: dark` — dark surfaces, ink inverted correctly, and the avatar initials remain legible. This is the shot that stands in for the I6 fix (avatar-initials contrast): the initials render in light text against the gradient in both light and dark mode, consistent with `40177a4`/`84b52b8` (per-palette avatar ink, AA contrast) rather than the pre-fix `var(--ink)`-on-gradient combination the final review measured at ~3.1:1. |
| *(fee-receipt print — no file written)* | **Skipped**, not captured. The script's own warning fired: `!! no .receipt-print visible on /manage/fees — needs a paid invoice; skipping`. No `s2b-fee-receipt-print-1280.png` exists in this commit. I checked the actual cause rather than taking the warning at face value: the DB **does** have 3 seeded `fee_payments` rows, so paid invoices exist. `.receipt-print` (`apps/web/app/(app)/manage/fees/page.tsx:610`) is not a persistent view of a historical payment — it only mounts for the duration of the in-session `receipt` state set immediately after a fresh `recordPayment()` call (the "Payment recorded" modal). The shot script navigates to `/manage/fees` and checks for the element without driving an actual payment, so this shot will skip regardless of seed state unless the script is changed to click through "Take payment → Record payment" first. M6 (the print-path regression risk) therefore remains unverified by screenshot this run; nothing in the migration itself is implicated. |

**Not S2b's doing, noted for completeness:** at 360px the top bar (`Search…⌘K` / `AY
2026-27` / notification bell / account menu) is tight enough that "Demo Administrator"
clips off the right edge in every 360px shot. That's shell/header chrome from S2a, out
of S2b's scope, and not something this task touched or fixed.

## 7. What S2b delivered

~25 screens across 6 batches (PEOPLE, TEACH, RECORDS, FEES, COMMUNICATION, REPORTS,
ADMINISTRATION, PORTAL) migrated from the legacy `apps/web/src/ui/*` primitives onto
`@vidya/ui-system` (`Button`, `Field`→`Input`/`Select`, `DataTable`→`Table`, `Card`,
`Modal`, `RingStat`, `Tabs`, `PageHeader`), with the `StudentDrawer` content relocated
verbatim into a tabbed `StudentSlideOver` used from 7 screens. Presentation-only: the
`api.*` call inventory is byte-identical on every one of the 27 `page.tsx` files between
base and head (verified independently by the final review), the backend diff is empty,
and 10 base `empty={...}` states map 1:1 onto `AsyncState` on head.

## 8. Final whole-branch review — 9 Important findings, all now fixed

The final review (`.superpowers/sdd/s2b-final-review.md`, `aa8f8d5..44da67f`) raised 9
Important findings beyond the per-task reviews. All 9 are fixed and re-covered by tests,
commits `d16d518..bf8a62e`:

| # | Finding | Fix commit |
|---|---|---|
| I1 | 26 right-aligned table columns silently went left (12 screens) | `Table` gained `align`, 26 columns restored |
| I2 | Error states diverged into 3 conventions; backlogs/calendar regressed to a dead-end (no retry) | `24b9ce6` |
| I3 | Avatar palette + `initials()` duplicated 7x | `0865103` |
| I5 | `SlideOver` lost the `prefers-reduced-motion` guard the old drawer had | `c7dffb7` |
| I6 | `StudentSlideOver` avatar initials failed WCAG AA (3.1:1) | `84b52b8`, `40177a4` |
| I7 | Legacy `PageHeader` shipped with zero tracked consumers; `/manage/system` 404s on a clean checkout | `7dd1122` (nav entry + dead `PageHeader` both dropped) |
| I8 | SlideOver close-state test was vacuous; `canManage` PII gate untested across 7 call sites | `61e191b`, `bf8a62e` |
| I9 | `Tabs` was an incomplete ARIA pattern (no `aria-controls`/`role="tabpanel"`) | `8b887d7` |
| I10 | (documentation, not code) e2e's 3-selector coverage is not the regression net the plan assumed | addressed by writing this section and §1 honestly rather than a code change |

I4 (67 duplicated CSS rules across page modules) was **partially** addressed — the
`.lede` half was resolved with a `lede` slot on ui-system `PageHeader` (`c3e9c65`),
deleting the negative-margin-coupled duplicate on every screen that had it. The rest of
I4 is deferred (below).

## 9. Deferred to the follow-up shell/CSS slice

Recorded here so the follow-up work has a fixed reference point, not re-litigated:

- **Rest of I4**: `.formGrid` ×13, `.confirmMessage` ×9, `.skeletonStack` ×7,
  `.field`/`.label`/`.textarea` ×4, plus a ui-system `Textarea` to retire the hand-rolled
  textarea styling.
- **M1** — the legacy `ToastProvider` in `app/(app)/layout.tsx` is now vestigial (zero
  real `useToast` consumers left after the migration); a shell-level cleanup, not S2b's.
- **M2** — `Button` needs an `as`/`asChild` prop so download links stop needing
  `.btn ghost`, then the 3 remaining legacy `<button className="btn">`s can convert.
- **M7** — `Table` uses index row keys (`key={i}`); fine for today's display-only cells,
  needs a `rowKey` prop before any sortable/stateful table is built on it.
- **M10** — `.btn.danger` / `.btn.danger:hover` in `globals.css` are confirmed dead,
  kept deliberately pending the shell CSS sweep.
- **`.cw-photo` white-text AA gap** for any consumer not yet passing a palette ink —
  the same class of contrast issue I6 fixed for the SlideOver avatar, not yet swept
  everywhere `.cw-photo` is used.

## 10. Environment notes (this run)

- Prod build: **first attempt succeeded**, no OOM, no `next.config.ts` changes needed
  (free RAM was ~1.6-1.9 GB going in).
- `pnpm compose:up` brought up `postgres`/`redis`/`minio` healthy. The `migrate` service
  (a separate, Docker-built container distinct from the app itself) failed with
  `Cannot find package 'prom-client'` — a broken/stale image, unrelated to S2b. It did
  not block this task: the Postgres data volume already carried a fully-applied schema
  from a prior run (`pnpm db:status` → **26 applied, 0 pending**) and demo seed data (96
  students, `demo-admin`, 3 fee payments), so `pnpm seed:demo` was not needed either.
  Flagging the broken `migrate` image for awareness; not a code defect and out of scope
  to fix under a verification task.
