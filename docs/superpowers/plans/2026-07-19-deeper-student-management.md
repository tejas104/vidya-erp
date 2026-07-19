# Deeper Student Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen student management with a rich profile page, college-wide search, and section promotion/bulk actions — reusing existing endpoints wherever possible.

**Architecture:** Three slices. **A** rewrites the thin `/students/[studentId]` page to add an identity/guardian header + documents block on top of the existing performance content (no backend). **B** adds one new read route `people.student-search` (repo → service → handler → route → client → UI), row-filtered by the caller's read scope with the same per-student `checkScope` idiom `studentGet` already uses. **C** adds promotion/bulk modals on `/manage/students` that orchestrate the existing audited `people.student-enroll` / `people.student-update` client methods (no backend).

**Tech Stack:** Next.js App Router (`apps/web`), `@vidya/module-people` (Drizzle/Postgres), TS strict, vitest (`unit`/`ui`/`integration` projects), pnpm.

## Global Constraints

- **Ponytail**: smallest change that fully works; reuse before build; **no new runtime deps** (ADR-0009).
- **Real endpoints only**; every screen honours the **five states** (loading / empty / error / denied-403 / withheld).
- **Both themes from tokens**; `:focus-visible`; respect `prefers-reduced-motion`.
- **ScopeChecker is human-owned** — no edits to `scope-checker.ts` or its conformance matrix in this plan. Slice B reuses the existing per-student `checkScope(..., "read", {resourceType:"student"})` idiom; nothing new is authorised.
- Test env vars (bash) before integration/seed: `DATABASE_URL`, `REDIS_URL`, `S3_*` per `docs/NEXT-SESSION.md`.
- Unit/UI suite baseline: **715 passing** (`npx vitest run --project unit --project ui`).
- After any route change: `pnpm openapi:generate`; build check `pnpm --filter @vidya/web build`.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## Task order & parallelism

- **Task A** is independent (touches only `students/[studentId]/page.tsx` + one `api.ts` method) → may run in parallel.
- **Task B** then **Task C** run **sequentially** — both edit `manage/students/page.tsx` and `api.ts`.

---

## Task A: Rich student profile page

**Files:**
- Modify: `apps/web/src/ui/api.ts` — add `getStudent(id)` client (document list/download clients already exist).
- Modify: `apps/web/app/(app)/students/[studentId]/page.tsx` — add profile header + documents block; restyle to tokens.
- Test: `apps/web/src/ui/student-profile-page.test.tsx` (new).

**Interfaces:**
- Consumes: existing `api.studentPerformance(id, year)`, `api.studentDocuments(id)`, `api.documentDownloadUrl(id)` (verify exact names in `api.ts`; the drawer uses them).
- Produces: `api.getStudent(studentId: string): Promise<StudentView>`.

- [ ] **Step 1: Add the `getStudent` client method**

In `apps/web/src/ui/api.ts`, next to `sectionRoster` (the `people` client group), add:

```ts
getStudent: (studentId: string) =>
  get<StudentView>(`/api/v1/people/students/${encodeURIComponent(studentId)}`),
```

Confirm the document-list + download client names by grepping `api.ts` for `documents` and reuse them verbatim in Step 4 (do NOT invent names).

- [ ] **Step 2: Write the failing UI test**

Create `apps/web/src/ui/student-profile-page.test.tsx`, mirroring the structure of `apps/web/src/ui/backlogs-page.test.tsx` (same render/mock harness). Cover three cases:

```tsx
// 1. Renders the profile header from getStudent + performance content.
//    Mock api.getStudent -> { admissionNo:"FYCS-001", fullName:"Asha Rao",
//      status:"active", enrollment:{sectionId:"sec1",academicYear:"2026-27"},
//      phone:"+91 90000 00000", guardianName:"Rao", guardianPhone:null, dob:"2005-01-01",
//      identityUserId:null, id:"stu1", collegeId:"c1" }
//    Mock api.studentPerformance -> minimal ok payload (name, attendance:null, overallPct:null, subjects:[]).
//    Mock api.studentDocuments -> [].
//    Assert: admission no., status label, guardian name all appear; "No documents" empty state shows.

// 2. Withheld profile: api.getStudent rejects with ApiError 403 while performance still resolves.
//    Assert: the page still renders performance content and shows an honest "profile not in your scope" note
//    (NOT a full-page error).

// 3. Documents present: api.studentDocuments -> [{id:"d1", kind:"marksheet", filename:"sem1.pdf", ...}].
//    Assert: filename renders with a download link.
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run --project ui student-profile-page`
Expected: FAIL (new header/documents markup absent).

- [ ] **Step 4: Implement the page**

Rewrite `apps/web/app/(app)/students/[studentId]/page.tsx`:
- Load `getStudent`, `studentPerformance`, and `studentDocuments` **in parallel** (`Promise.allSettled` so a 403 on the profile doesn't sink performance). Keep the existing performance JSX (`StatTile`/`Sparkline`/`SubjectBars`) unchanged.
- Add a **profile header** above the stats card: avatar (if a `photo` document exists, render its download URL as `<img>`; else a monogram of `fullName`), `fullName`, admission no., a status badge (reuse the students-page `STATUS_LABEL` mapping — copy the small map locally, don't export), current section label + academic year from `enrollment`, and phone / DOB / guardian name / guardian phone rows. Any null field renders a muted "—"; if `getStudent` was 403/forbidden, render a single muted line "Profile details aren't in your scope." instead of the header fields.
- Add a **Documents** section: list `studentDocuments` (kind + filename + a download link via the existing download-url client); empty state "No documents on file." Read-only — no upload control.
- Replace the "← Back to the register" link and any legacy `.card`/`.eyebrow`-only styling with current token classes already used on this page; keep it consistent with the workspace drawer's look.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project ui student-profile-page`
Expected: PASS (3 tests).

- [ ] **Step 6: Full suite + build**

Run: `npx vitest run --project unit --project ui` → expect 715 + 3 passing.
Run: `pnpm --filter @vidya/web build` → clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/api.ts apps/web/app/\(app\)/students/\[studentId\]/page.tsx apps/web/src/ui/student-profile-page.test.tsx
git commit -m "feat(web): rich student profile page (identity, guardian, documents)"
```

---

## Task B: College-wide student search

**Files:**
- Modify: `packages/modules/people/src/repo/people-repo.ts` — add `searchStudents` to `PeopleRepo` + impl.
- Modify: `packages/modules/people/src/service/people-service.ts` — delegate `searchStudents`.
- Modify: `packages/modules/people/src/api/handlers.ts` — add `studentSearch` handler + register in the returned map.
- Modify: `packages/modules/people/src/definition.ts` — add the `people.student-search` RouteSpec.
- Create: `apps/web/app/api/v1/people/students/search/route.ts` (thin Next wrapper — copy an existing GET route file byte-for-byte and swap the spec id).
- Modify: `apps/web/src/ui/api.ts` — add `searchStudents` client + `StudentSearchHit` type.
- Modify: `apps/web/app/(app)/manage/students/page.tsx` — add the search box + results list.
- Test (repo/unit): `packages/modules/people/src/repo/people-repo.test.ts` (or the existing people repo test file — grep first).
- Test (handler/unit): `packages/modules/people/src/api/handlers.test.ts` — add a scope-filter case.
- Test (integration): `tests/integration/student-search-flow.int.test.ts` (new).

**Interfaces:**
- Produces (repo): `searchStudents(collegeId: string, q: string): Promise<{ student: PplStudentRow; sectionLabel: string | null }[]>` — ILIKE match on `full_name` OR `admission_no`, current-year live-enrollment left-joined to section→class for the label, capped at 50, ordered by `full_name`.
- Produces (service): `searchStudents(collegeId, q)` delegating to the repo.
- Produces (route): `GET /api/v1/people/students/search?collegeId={id}&q={q}` → `{ students: StudentSearchHit[] }` where `StudentSearchHit = { id, admissionNo, fullName, status, sectionLabel: string | null }`.
- Produces (client): `api.searchStudents(collegeId: string, q: string): Promise<{ students: StudentSearchHit[] }>`.

- [ ] **Step 1: Write the failing repo test**

Add to the people repo test file (grep `people-repo.test` / existing repo tests to match harness):

```ts
it("searchStudents matches name or admission no and labels the current section", async () => {
  // seed: college, dept, class, section; two students, one enrolled in the section.
  // Asha Rao (admission FYCS-001) enrolled; Bhavesh Kar (FYCS-002) not enrolled.
  const byName = await repo.searchStudents(collegeId, "asha");
  expect(byName.map((r) => r.student.admissionNo)).toContain("FYCS-001");
  expect(byName[0]!.sectionLabel).toMatch(/Sec/);
  const byAdm = await repo.searchStudents(collegeId, "FYCS-002");
  expect(byAdm.map((r) => r.student.admissionNo)).toContain("FYCS-002");
  expect(byAdm.find((r) => r.student.admissionNo === "FYCS-002")!.sectionLabel).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit people-repo` → FAIL (`searchStudents` not a function).

- [ ] **Step 3: Implement `searchStudents` in the repo**

In `people-repo.ts`: add `ilike, or` to the `drizzle-orm` import and `pplSections` to the schema import (confirm the export name). Add to the `PeopleRepo` interface:

```ts
searchStudents(
  collegeId: string,
  q: string,
): Promise<{ student: PplStudentRow; sectionLabel: string | null }[]>;
```

Implement (mirror `roster` + `findStudentByAdmissionNo`):

```ts
async searchStudents(collegeId, q) {
  const term = `%${q.trim()}%`;
  const rows = await db
    .select({
      student: pplStudents,
      className: pplClasses.name,
      sectionName: pplSections.name,
    })
    .from(pplStudents)
    .leftJoin(
      pplEnrollments,
      and(eq(pplEnrollments.studentId, pplStudents.id), eq(pplEnrollments.status, "enrolled")),
    )
    .leftJoin(pplSections, eq(pplEnrollments.sectionId, pplSections.id))
    .leftJoin(pplClasses, eq(pplSections.classId, pplClasses.id))
    .where(
      and(
        eq(pplStudents.collegeId, collegeId),
        or(ilike(pplStudents.fullName, term), ilike(pplStudents.admissionNo, term)),
      ),
    )
    .orderBy(asc(pplStudents.fullName))
    .limit(50);
  return rows.map((r) => ({
    student: r.student,
    sectionLabel:
      r.className !== null && r.sectionName !== null ? `${r.className} · Sec ${r.sectionName}` : null,
  }));
}
```

Note: a student with multiple historical enrollments would duplicate; the `status = "enrolled"` join filter keeps at most the live one (partial-unique per year). If duplicates appear across years, dedupe by `student.id` in the handler.

- [ ] **Step 4: Run the repo test to verify it passes**

Run: `npx vitest run --project unit people-repo` → PASS.

- [ ] **Step 5: Delegate in the service**

In `people-service.ts`, next to `roster`:

```ts
searchStudents(collegeId: string, q: string) {
  return this.deps.repo.searchStudents(collegeId, q);
}
```

- [ ] **Step 6: Write the failing handler scope-filter test**

In `packages/modules/people/src/api/handlers.test.ts`, add a case for `studentSearch` mirroring the existing `studentGet` handler tests:

```ts
it("student-search returns only students whose org position the caller can read", async () => {
  // Arrange two matches; stub people.searchStudents to return both,
  // stub people.studentOrgPosition per student, and a scopeChecker that
  // grants "read" for student1's position and denies student2's.
  // Act: call the studentSearch handler with q="a".
  // Assert: body.students has exactly student1 (student2 filtered out).
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run --project unit people/src/api/handlers` → FAIL (no `studentSearch`).

- [ ] **Step 8: Implement the `studentSearch` handler**

In `handlers.ts`, add (mirror `studentGet`'s per-student `checkScope`):

```ts
const studentSearch: RouteHandler = async (ctx) => {
  const principal = ctx.principal as Principal;
  const query = ctx.request.query as { collegeId: string; q: string };
  const matches = await deps.people.searchStudents(query.collegeId, query.q);
  const visible: { id: string; admissionNo: string; fullName: string; status: string; sectionLabel: string | null }[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    if (seen.has(match.student.id)) continue;
    const position = await deps.people.studentOrgPosition(match.student);
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", {
      module: "people",
      resourceType: "student",
      org: position,
    });
    if (!scope.ok) continue;
    seen.add(match.student.id);
    visible.push({
      id: match.student.id,
      admissionNo: match.student.admissionNo,
      fullName: match.student.fullName,
      status: match.student.status,
      sectionLabel: match.sectionLabel,
    });
  }
  return { status: 200, body: { students: visible } };
};
// ponytail: N per-row scope checks (capped at 50 matches). If search latency
// bites, push the read-scope filter into the SQL. Upgrade path noted in the spec.
```

Register it in the handler map returned at the bottom of `createPeopleHandlers` (next to `"people.section-roster": sectionRoster,`):

```ts
"people.student-search": studentSearch,
```

- [ ] **Step 9: Add the RouteSpec**

In `definition.ts`, add a spec (place it near `people.section-roster`, and confirm `ANY_AUTHENTICATED` + `z`/`idSchema`/`problemSchema` are already imported):

```ts
{
  id: "people.student-search",
  module: MODULE_NAME,
  method: "GET",
  path: "/api/v1/people/students/search",
  summary: "Search students college-wide by name or admission no. (results row-filtered by read scope)",
  tags: ["people-students"],
  auth: ANY_AUTHENTICATED,
  request: {
    query: z.object({ collegeId: idSchema, q: z.string().trim().min(1).max(80) }),
  },
  responses: {
    200: {
      description: "Matching students the caller may read",
      schema: z.object({
        students: z.array(
          z.object({
            id: z.string(),
            admissionNo: z.string(),
            fullName: z.string(),
            status: studentStatusSchema,
            sectionLabel: z.string().nullable(),
          }),
        ),
      }),
    },
  },
},
```

If the RouteSpec type requires query params to be declared a specific way, mirror an existing GET-with-query spec in this file (grep `query:` in `definition.ts`).

- [ ] **Step 10: Run handler + build the module**

Run: `npx vitest run --project unit people` → PASS.
Run: `pnpm --filter @vidya/module-people build` (or the repo's typecheck) → clean.

- [ ] **Step 11: Add the Next route wrapper + regenerate OpenAPI**

Copy an existing GET route file (e.g. `apps/web/app/api/v1/people/sections/[sectionId]/roster/route.ts`) to `apps/web/app/api/v1/people/students/search/route.ts`, changing only the spec id it dispatches to (`people.student-search`). Then:

Run: `pnpm openapi:generate` → `docs/openapi/openapi.json` updates with the new path.

- [ ] **Step 12: Add the client method + type**

In `api.ts`, add near the other people types:

```ts
export interface StudentSearchHit {
  id: string; admissionNo: string; fullName: string;
  status: StudentStatus; sectionLabel: string | null;
}
```

and in the client group:

```ts
searchStudents: (collegeId: string, q: string) =>
  get<{ students: StudentSearchHit[] }>(
    `/api/v1/people/students/search?collegeId=${encodeURIComponent(collegeId)}&q=${encodeURIComponent(q)}`,
  ),
```

- [ ] **Step 13: Write the failing students-page search test**

Add to `apps/web/src/ui/` a test `students-search.test.tsx` (or extend an existing students-page test if one exists — grep). Mock `api.searchStudents` to return two hits; type into the search box; assert both names render as links to `/students/{id}` and the section browser is hidden while a query is present.

- [ ] **Step 14: Run it to verify it fails**

Run: `npx vitest run --project ui students-search` → FAIL.

- [ ] **Step 15: Add the search box to the students page**

In `apps/web/app/(app)/manage/students/page.tsx`: add a `query` state + `hits` state. Render a search `<input>` (labelled, `type="search"`) above the section `<Field>`. Debounce (~250ms via a `setTimeout` in `useEffect` on `query`) → call `api.searchStudents(tree.college.id, query)` when `query.trim()` is non-empty, else clear hits and show the existing section browser. When a query is present, render the results as a `DataTable` or simple list: admission no. (`.num`), name linking to `/students/{id}`, class·sec (or "—"), status label. Loading + empty ("No students match.") states. Reuse `STATUS_LABEL` already defined in this file.

```tsx
// ponytail: debounce via setTimeout in a useEffect; no new dep.
```

- [ ] **Step 16: Run the UI test to verify it passes**

Run: `npx vitest run --project ui students-search` → PASS.

- [ ] **Step 17: Write the integration test (real DB, scope proof)**

Create `tests/integration/student-search-flow.int.test.ts`, mirroring `tests/integration/corrections-flow.int.test.ts` harness setup. Seed a college with two sections in different classes and a student in each. Assert:
- an **admin** search for a common term returns **both** students (cross-section);
- a **subject teacher** scoped to only one section, searching the same term, returns **only** the student whose section they can read.

- [ ] **Step 18: Run the integration test**

Run (bash env loaded): `INTEGRATION_RESET_DB=true npx vitest run --project integration --no-file-parallelism student-search`
Expected: PASS (both assertions).

- [ ] **Step 19: Full suite + build + commit**

Run: `npx vitest run --project unit --project ui` → all green.
Run: `pnpm --filter @vidya/web build` → clean.

```bash
git add packages/modules/people apps/web/app/api/v1/people/students/search apps/web/src/ui/api.ts apps/web/app/\(app\)/manage/students/page.tsx apps/web/src/ui/students-search.test.tsx docs/openapi/openapi.json tests/integration/student-search-flow.int.test.ts
git commit -m "feat(people): college-wide student search, row-filtered by read scope"
```

---

## Task C: Year-end promotion / bulk actions

**Files:**
- Modify: `apps/web/app/(app)/manage/students/page.tsx` — add "Promote section" + "Graduate → alumni" modals.
- Test: `apps/web/src/ui/students-promote.test.tsx` (new).

**Interfaces:**
- Consumes: `api.enrollStudent(studentId, { sectionId, academicYear })` and `api.updateStudent(studentId, { status })` (already used on this page); `api.sectionRoster(sectionId)` for the source list; `sectionOptions(tree)` (already defined in this file).
- Produces: nothing new — UI only.

- [ ] **Step 1: Write the failing UI test**

Create `apps/web/src/ui/students-promote.test.tsx`. Render the students page with a loaded roster of two **active** students. Open "Promote section", pick a target section + academic year, submit. Mock `api.enrollStudent` to resolve for one student and reject (ApiError 403) for the other. Assert the summary shows "1 promoted" and "1 failed" with the failing student's name and reason.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project ui students-promote` → FAIL.

- [ ] **Step 3: Implement the promote modal**

In `manage/students/page.tsx` add a `promoting` boolean state, `promoteTo` (target sectionId) + `promoteYear` state, and a `summary` result state. Add a "Promote section" `<Button>` near "Add student" (enabled when a roster is loaded). The modal:
- target `<select>` from `sectionOptions(tree)` excluding the current `sectionId`;
- academic-year input defaulting to the next year (derive from `currentAcademicYear()` — increment the leading year; keep it a plain text field so the admin can override);
- on submit, iterate `roster.filter((s) => s.status === "active")`, calling `enrollStudent(s.id, { sectionId: promoteTo, academicYear })` inside a per-student `try/catch`, tallying `{ promoted: string[]; failed: {name,reason}[] }`;
- render the summary after completion; refresh the roster.

```tsx
// ponytail: client-orchestrated N enroll calls, not one transaction. A partial
// failure leaves some promoted; the summary reports exactly which. Upgrade path:
// a transactional POST /sections/{id}/promote if this once-a-year action needs atomicity.
```

- [ ] **Step 4: Add the "Graduate → alumni" bulk action**

Same modal pattern (or a second small confirm modal): iterate the active roster calling `updateStudent(s.id, { status: "alumni" })`, tally + summary + reload. Guard behind a typed/explicit confirm since it's bulk-destructive-ish (status-only, reversible, but broad).

- [ ] **Step 5: Run the UI test to verify it passes**

Run: `npx vitest run --project ui students-promote` → PASS.

- [ ] **Step 6: Full suite + build**

Run: `npx vitest run --project unit --project ui` → all green.
Run: `pnpm --filter @vidya/web build` → clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(app\)/manage/students/page.tsx apps/web/src/ui/students-promote.test.tsx
git commit -m "feat(web): section promotion + graduate-to-alumni bulk actions"
```

---

## Final verification (after all three tasks)

- [ ] `npx vitest run --project unit --project ui` — all green (≈ 715 + new tests).
- [ ] `INTEGRATION_RESET_DB=true npx vitest run --project integration --no-file-parallelism student-search` — green.
- [ ] `pnpm openapi:generate` clean (no uncommitted drift); `pnpm --filter @vidya/web build` clean.
- [ ] Reseed clean; **owner eyeballs** (no screenshot tooling here): the profile page (header + documents), the search box on `/manage/students`, and the promote / graduate modals.
- [ ] Update memory `vidya-4step-plan.md` with the outcome.

## Self-review notes (author)

- **Spec coverage:** Slice A → Task A; Slice B → Task B (repo/service/handler/route/client/UI/integration all present); Slice C → Task C. Row-filter requirement → Task B Steps 6–8 + integration Step 17. No scope-checker change anywhere. ✓
- **Ponytail ceilings** are each marked with a `ponytail:` comment + upgrade path (N scope checks in search; debounce via setTimeout; N enroll calls in promotion). ✓
- **Type consistency:** `StudentSearchHit` shape is identical across definition schema (Step 9), client type (Step 12), and handler body (Step 8). `searchStudents` repo return `{student, sectionLabel}` is consistent between Steps 3 and 8. ✓
- **Verify-before-assert:** every unnamed reference (document client method names, existing students-page test file, `pplSections` export, GET-with-query RouteSpec shape) is called out with a "grep/confirm first" instruction rather than assumed. ✓
