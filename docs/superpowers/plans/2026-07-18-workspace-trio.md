# Class Workspace Trio — Implementation Plan

Three mostly-independent additions to Project Vidya, executed subagent-driven on branch `feat/syllabus-module` (continues after the syllabus module). Each task commits independently and self-verifies.

## Global Constraints (bind every task)

- **Ponytail**: smallest change that fully works; reuse before build; **no new runtime deps** (ADR-0009).
- **Real endpoints only** — no hardcoded demo numbers in UI. Missing data → honest empty/withheld state.
- **Five states** per screen: loading / empty / error / denied(403) / withheld.
- **Both themes** from CSS tokens (`var(--…)`); `:focus-visible`; respect `prefers-reduced-motion`. No hand-rolled hex in components (use existing `cw-*` classes / tokens).
- **NO ScopeChecker / grant-matrix change** (`packages/modules/identity/src/core/scope-checker.ts`). Reuse existing scope checks. If a task cannot proceed without touching it, STOP and flag.
- After any route add/change: `pnpm openapi:generate`. Verify each task: `pnpm --filter @vidya/web exec tsc --noEmit`; touched-module vitest `--project unit`/`--project ui`; where a route changes, `pnpm check:ownership` must not regress (note: fees/notices ALREADY fail ownership at HEAD — pre-existing, unrelated; a task passes if it introduces no NEW ownership violation).
- Test env vars (bash) per `docs/NEXT-SESSION.md`. Integration: `INTEGRATION_RESET_DB=true npx vitest run --project integration --no-file-parallelism <substr>`.
- New modules/routes must be registered wherever the module list is duplicated: `apps/web/src/composition.ts`, `apps/worker/src/main.ts`, `scripts/seed-demo.ts` (`buildStack`), `tests/integration/support/harness.ts`. (Tasks here modify EXISTING modules, so mostly N/A — but a NEW system-service seam consumed by academics must be threaded through all four composition points.)
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. Do NOT push.
- **No screenshot tooling** — visual correctness is the owner's to confirm; state clearly "not visually verified".

---

### Task 1: Seed 3 sections per class (enables the section-switcher wishlist)

**Files:** Modify `scripts/seed-demo.ts` only.

**Context:** Today each class in `DEPARTMENTS` has `sections: ["A"]` and every student enrolls into `rosterSection` "A", where ALL record-seeding (attendance, marks, fees, syllabus, timetable) is anchored. The goal is ≥3 real sections per class so a future student section-switcher has something to switch between — WITHOUT disturbing the section-A record data (keep the demo's rich A intact).

**Approach (purely additive, contained to the seed):**
- In the `DEPARTMENTS` data, give every class `sections: ["A", "B", "C"]` (keep `rosterSection: "A"`). The seed already creates a section per name (loop at `for (const sectionName of klass.sections)`), so B and C get created automatically.
- After the existing students enroll into `rosterSectionId` (section A) and all A-anchored record-seeding runs, enroll a SMALL set of NEW students into B and C so they are not empty: for each class, 3 students into B and 2 into C (India-realistic names; admission numbers continuing the class's series, e.g. `${klass.code}-B01`). These new students get the 2.5 profile fields (mirror the existing profile block: phone/guardianName/guardianPhone/dob) but NO attendance/marks/fees (honest — a freshly-populated section). Do NOT change the struggler/backlog logic or the portal-student pick (both key off section-A students).
- Keep every existing A-anchored block byte-for-byte in behavior (rosterSectionId stays A). The only new work is: (a) two extra section names in data, (b) a small enroll-into-B/C loop with profile backfill.

**Verify:**
- Reseed clean (drop schema in the postgres container → `npx tsx scripts/migrate.ts up` → `VIDYA_ALLOW_DEMO_SEED=true npx tsx scripts/seed-demo.ts`). Seed completes with `✓`; console shows 3 sections per class and the new B/C enrolments.
- Sanity check via a query (docker psql or a tsx snippet): each class has 3 sections; section A still holds its original roster + attendance; B and C have the new students and zero attendance sessions.
- No app-test impact expected (other tests use their own orgs), but run `npx vitest run --project unit --project ui` to confirm the baseline (711) still passes.

**Commit:** `feat(seed): 3 sections per class (A records intact; B/C freshly enrolled)`

---

### Task 2: Subject-teachers aside in the Class Workspace

**Files:**
- Modify `packages/modules/people/src/api/handlers.ts` (or wherever `class-assignments` is handled) + `packages/modules/people/src/definition.ts` (enrich `assignmentViewSchema`).
- Modify `packages/modules/people/src/api/handlers.test.ts` (or the people handler test) — assert names populate.
- Modify `apps/web/src/ui/api.ts` (client type + a `classAssignments` method if absent).
- Modify `apps/web/app/(app)/manage/classes/page.tsx` (add a "Subject teachers" panel to `<aside className="cw-aside">`, above or below the Today panel).
- Regenerate OpenAPI.

**Context:** The workspace aside currently shows only the "Today" timeline. `GET /api/v1/people/classes/{classId}/assignments` (`people.class-assignments`, `assignmentViewSchema` = `{ id, teacherId, classId, subjectId, kind, academicYear }`) returns IDs only. There is NO teacher-list endpoint. The workspace already loads `dash.names` (subject/class names) but not necessarily teacher names.

**Approach (enrich the existing endpoint — one request, no new route):**
- Extend `assignmentViewSchema` with `teacherName: z.string().nullable()` and `subjectName: z.string().nullable()` (additive, nullable — existing consumers like the timetable seed ignore extra fields). Resolve both in the `class-assignments` handler via the people directory's name resolver (`namesFor` / `teacherByIdentityUser`-style — read how the handler already resolves names elsewhere; teachers resolve by teacherId, subjects by subjectId). Keep the existing fields.
- Update the people handler test to assert the enriched names appear for a subject_teacher and a class_teacher (subjectId null → subjectName null).
- `apps/web/src/ui/api.ts`: add/confirm a `classAssignments(classId)` client returning the enriched type.
- `page.tsx`: after loading `opt`, fetch `api.classAssignments(opt-derived classId)` (the workspace knows the class via the dashboard tile — thread the `classId` onto `ClassOpt`, OR resolve it; simplest: add `classId` to `ClassOpt` when building `opts` from `dash` tiles — the tile already has `tile.classId`). Render a `cw-panel` "Subject teachers" listing `subjectName — teacherName` (class_teacher shown with a "CT" tag; subjectId-null class_teacher rows show their taught subject or "Class teacher"). Five states: loading Skeleton, empty ("No teachers assigned yet."), error (best-effort `catch` → hide/omit, like the fees overlay). Best-effort: a failure must NOT break the roster.

**Verify:** people unit test green (names populate); `pnpm --filter @vidya/web exec tsc --noEmit`; `npx vitest run --project unit --project ui` green; `pnpm openapi:generate`; `pnpm --filter @vidya/web build`. Visuals NOT verified.

**Commit:** `feat(web): subject-teachers aside in the class workspace`

---

### Task 3: Recent-corrections queue in the Class Workspace

**Files:**
- Modify `packages/modules/system/src/service/audit-writer.ts` (+ its test) — add `readAuditEventsByAction`.
- Modify `packages/modules/system/src/index.ts` — expose it on the system service.
- Modify `packages/modules/academics/src/index.ts` — add a `readAuditByAction` dep to the academics deps (mirror the existing `readAudit` seam).
- Modify `packages/modules/academics/src/api/handlers.ts` + `definition.ts` — new route `academics.section-corrections`.
- Modify `packages/modules/academics/src/api/handlers.test.ts` — cover the new route.
- Modify the FOUR composition points that build academics: `apps/web/src/composition.ts`, `apps/worker/src/main.ts`, `scripts/seed-demo.ts`, `tests/integration/support/harness.ts` — pass the new `readAuditByAction` seam.
- Modify `apps/web/src/ui/api.ts` (client + type) and `apps/web/app/(app)/manage/classes/page.tsx` (a "Recent corrections" panel in the aside + enable the disabled "Review corrections" hero button to reveal/anchor it).
- Regenerate OpenAPI. Add an integration test `tests/integration/corrections-flow.int.test.ts`.

**Context:** Attendance corrections are already written to the append-only audit log by `academics.attendance-correct` as action `academics.attendance-corrected`, `resourceType: "attendance-entry"`, resourceId `"${sessionId}/${studentId}"`, details `{ sessionId, studentId, before, after }`. `mark-history` already reads the audit log via a `readAudit(resourceType, resourceId, limit)` seam. `readRecentAuditEvents(db, limit)` exists but is not action-filtered, and audit reads are not section-scoped. The workspace hero has a disabled button `title="corrections queue not wired yet"`.

**Approach:**
- **system audit reader**: add `readAuditEventsByAction(db, action, limit)` beside `readRecentAuditEvents` (same shape, `WHERE action = $1 ORDER BY occurred_at DESC LIMIT $2`; validate limit like the sibling). Test it (mirror the existing `readRecentAuditEvents` test). Expose on the system service in `index.ts`.
- **academics dep**: add `readAuditByAction: (action, limit) => Promise<AuditHistoryEntry[]>` to the academics module deps next to `readAudit`; wire it in all four composition points to `system.service.readAuditEventsByAction`.
- **new route** `academics.section-corrections`: `GET /api/v1/academics/sections/{sectionId}/corrections`, auth ANY_AUTHENTICATED, query `{ limit?: number (default 50, max 200) }`. Handler: resolve `sectionPosition(sectionId)` (404 if none) → `checkScope(..., "read", attendanceRef(position))` (403 if denied — SAME scope pattern as `section-attendance`, no scope-checker change) → read recent `academics.attendance-corrected` events via `readAuditByAction` → filter to those whose `details.sessionId` belongs to THIS section (resolve each session's sectionId via the attendance read model — reuse `getSession`/`sessionWithEntries`; cache session→section lookups to avoid dup reads) → resolve student names (people directory `namesFor`) → return `{ corrections: [{ sessionId, studentId, studentName, before, after, at, byName? }] }` newest-first. Actor name (`byName`) via the audit row's actorId + directory if cheap; else omit. Cap the number of session lookups (only distinct sessionIds from the fetched events).
- **web**: `api.sectionCorrections(sectionId)`; a `cw-panel` "Recent corrections" in the aside (loading Skeleton / empty "No corrections recorded." / best-effort catch → hide). Enable the hero "Review corrections" button: on click, scroll the corrections panel into view (or toggle a filter) — a real affordance, no longer disabled. Each row: `studentName · before → after · <relative time> · byName`.
- **integration** `tests/integration/corrections-flow.int.test.ts` (mirror `academics-flow.int.test.ts` harness + the existing correction test): a class teacher records a session, corrects an entry, then `GET /sections/{sectionId}/corrections` returns that correction with the right before/after and student; a subject teacher of another subject is 403 (scope wall).

**Verify:** system unit test (new reader) green; academics unit test (new route) green; integration `corrections` green; `pnpm --filter @vidya/web exec tsc --noEmit`; `npx vitest run --project unit --project ui` green; `pnpm openapi:generate`; `pnpm check:ownership` (no NEW violation); `pnpm --filter @vidya/web build`. Visuals NOT verified.

**Commit:** `feat(academics): section corrections queue + workspace panel`

---

## Final (controller): whole-branch review + full sweep

After all three tasks: broad code review of the branch, then the full sweep — reseed clean, `npx vitest run --project unit --project ui`, all touched integration tests, `pnpm --filter @vidya/web build`, `pnpm check:ownership` (no new violations). Report what is and isn't visually verified; leave push/merge to the owner.
