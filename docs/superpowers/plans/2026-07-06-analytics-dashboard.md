# Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/dashboard` into a role-adaptive, read-only, multi-graph analytics dashboard (hand-rolled SVG), backed by two new scope-checked analytics endpoints and an enriched demo seed.

**Architecture:** Two new `QueryService` methods (`childrenRollups`, `distribution`) served by two new analytics routes reuse the existing closure + minimum-cohort helpers, so every graph inherits ADR-0018 by construction. The web client gains matching typed methods; `charts.tsx` gains four SVG primitives; `/dashboard` composes them role-adaptively. The demo seeder is enriched so the graphs render full.

**Tech Stack:** TypeScript, Next.js 16 (App Router), Zod route specs, Drizzle, Vitest, React Testing Library, Playwright. No new runtime dependency (ADR-0009).

## Global Constraints

- **No new dependencies.** Charts are hand-rolled SVG; CDN-free (ADR-0009).
- **Read-only.** No writes, no identity/auth-core changes.
- **Disclosure rules are non-negotiable.** Every served aggregate goes through `QueryService` → the `aggregation-scope` helpers (constituent-closure + `cohortSufficient(n, minCohort)`), exactly like the existing `rollup`/`at-risk` handlers. Never query rollup tables or academics tables directly from a new path.
- **Minimum cohort** comes from `deps.minCohort` (config `ANALYTICS_MIN_COHORT`, default 5). Never hardcode 5 in production code.
- **Module boundaries** are build-enforced (eslint-plugin-boundaries). Analytics may import `@vidya/module-people` and `@vidya/platform` types only (already the case).
- **Every `PeopleDirectory` implementor** must implement new interface methods or `pnpm -r typecheck` fails. Implementors: `packages/modules/people/src/index.ts` (real), `packages/modules/analytics/test-support/fakes.ts` (`FakeDirectory`), `packages/modules/academics/test-support/fakes.ts` (`FakePeopleDirectory`).
- **Academic year** helper: server `academicYearForDate` (analytics), client `currentAcademicYear` (`api.ts`). Both roll over in June.
- Run from repo root with env loaded: `set -a && source .env && set +a` before any `tsx`/seed/curl command.

---

## Task 1: Extend `PeopleDirectory` with child-enumeration

**Files:**
- Modify: `packages/modules/people/src/repo/org-repo.ts` (interface `OrgRepo` ~L59-61; impl ~L149-155)
- Modify: `packages/modules/people/src/index.ts` (interface `PeopleDirectory` ~L88; impl ~L185)
- Modify: `packages/modules/analytics/test-support/fakes.ts` (`FakeDirectory` ~L151)
- Modify: `packages/modules/academics/test-support/fakes.ts` (`FakePeopleDirectory`)

**Interfaces:**
- Produces: `PeopleDirectory.departmentsOfCollege(collegeId: string): Promise<{ departmentId: string; name: string }[]>` and `PeopleDirectory.classesOfDepartment(departmentId: string): Promise<{ classId: string; name: string }[]>`; `OrgRepo.listDepartmentsOfCollege(collegeId: string): Promise<PplDepartmentRow[]>` and `OrgRepo.listClassesOfDepartment(departmentId: string): Promise<PplClassRow[]>`.

- [ ] **Step 1: Add the two methods to the `OrgRepo` interface**

In `org-repo.ts`, after `listSectionsOfClass(classId: string): Promise<PplSectionRow[]>;` (L60) add:

```ts
  listDepartmentsOfCollege(collegeId: string): Promise<PplDepartmentRow[]>;
  listClassesOfDepartment(departmentId: string): Promise<PplClassRow[]>;
```

- [ ] **Step 2: Implement them in `createOrgRepo`**

In `org-repo.ts`, right after the `listSectionsOfClass` impl (ends L155) add:

```ts
    async listDepartmentsOfCollege(collegeId) {
      return db
        .select()
        .from(pplDepartments)
        .where(eq(pplDepartments.collegeId, collegeId))
        .orderBy(asc(pplDepartments.code));
    },

    async listClassesOfDepartment(departmentId) {
      return db
        .select()
        .from(pplClasses)
        .where(eq(pplClasses.departmentId, departmentId))
        .orderBy(asc(pplClasses.code));
    },
```

- [ ] **Step 3: Add the two methods to the `PeopleDirectory` interface**

In `people/src/index.ts`, in `interface PeopleDirectory`, after `sectionsOfClass(...)` (L89) add:

```ts
  /** A college's departments (id + name), for cross-node comparison (analytics). */
  departmentsOfCollege(collegeId: string): Promise<{ departmentId: string; name: string }[]>;
  /** A department's classes (id + name), for cross-node comparison (analytics). */
  classesOfDepartment(departmentId: string): Promise<{ classId: string; name: string }[]>;
```

- [ ] **Step 4: Wire them in the real directory**

In `people/src/index.ts`, in the `directory: { ... }` object right after the `sectionsOfClass` entry (ends L189) add:

```ts
        departmentsOfCollege: async (collegeId) =>
          (await orgRepo.listDepartmentsOfCollege(collegeId)).map((department) => ({
            departmentId: department.id,
            name: department.name,
          })),
        classesOfDepartment: async (departmentId) =>
          (await orgRepo.listClassesOfDepartment(departmentId)).map((klass) => ({
            classId: klass.id,
            name: klass.name,
          })),
```

- [ ] **Step 5: Implement in both test fakes**

In `analytics/test-support/fakes.ts`, inside `class FakeDirectory`, after `sectionsOfClass` (ends L158) add:

```ts
  async departmentsOfCollege(collegeId: string) {
    return collegeId === ORG.collegeId ? [{ departmentId: ORG.departmentId, name: "Science" }] : [];
  }
  async classesOfDepartment(departmentId: string) {
    return departmentId === ORG.departmentId ? [{ classId: ORG.classId, name: "BSc Year 1" }] : [];
  }
```

In `academics/test-support/fakes.ts`, inside `class FakePeopleDirectory`, add the same two methods returning `[]` (academics tests don't compare nodes):

```ts
  async departmentsOfCollege(): Promise<{ departmentId: string; name: string }[]> {
    return [];
  }
  async classesOfDepartment(): Promise<{ classId: string; name: string }[]> {
    return [];
  }
```

- [ ] **Step 6: Typecheck (this is the deliverable gate)**

Run: `pnpm -r typecheck`
Expected: PASS. If it fails with "Property 'departmentsOfCollege' is missing", a `PeopleDirectory` implementor was missed — add the methods there.

- [ ] **Step 7: Commit**

```bash
git add packages/modules/people/src/repo/org-repo.ts packages/modules/people/src/index.ts packages/modules/analytics/test-support/fakes.ts packages/modules/academics/test-support/fakes.ts
git commit -m "feat(people): expose departmentsOfCollege + classesOfDepartment on the directory"
```

---

## Task 2: `QueryService.childrenRollups` (comparison data)

**Files:**
- Modify: `packages/modules/analytics/src/service/query-service.ts`
- Test: `packages/modules/analytics/src/service/query-service.test.ts` (create)

**Interfaces:**
- Consumes: `PeopleDirectory.departmentsOfCollege/classesOfDepartment/sectionsOfClass` (Task 1); existing `this.nodePath`, `this.nodeAttendance`, `this.nodeMarks`, `this.atRisk`.
- Produces: `QueryService.childrenRollups(principal, level, nodeId, academicYear)` returning `{ childLevel: ScopeLevel; children: ChildRollup[] } | null`, where `ChildRollup = { nodeId: string; name: string; attendance: AggState<AttendanceSummary> | { state: "denied" }; marks: AggState<MarksSummary> | { state: "denied"; deniedSubjectId?: string }; atRisk: number }`.

- [ ] **Step 1: Write the failing test**

Create `query-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Principal, ScopeGrant } from "@vidya/platform";
import { createIdentityCore } from "@vidya/module-identity";
import type { RedisClient } from "@vidya/platform";
import { QueryService } from "./query-service";
import { FakeAcademicsRead, FakeDirectory, InMemoryRollupsRepo, ORG, paths } from "../../test-support/fakes";

const core = createIdentityCore({ redis: {} as RedisClient, session: { ttlHours: 1, idleMinutes: 1 } });
const YEAR = "2026-27";
const principal = (roles: Principal["roles"], grants: ScopeGrant[]): Principal => ({
  id: "u", kind: "user", displayName: "u", roles, scopes: [], grants, sessionId: "s",
});
const principalUser = principal(["principal"], [{ role: "principal", org: paths.college }]);

function makeQuery() {
  const repo = new InMemoryRollupsRepo();
  const query = new QueryService({
    repo, academicsRead: new FakeAcademicsRead(), directory: new FakeDirectory(),
    scopeChecker: core.scopeChecker, minCohort: 5,
  });
  return { repo, query };
}

describe("QueryService.childrenRollups", () => {
  it("returns null for an unknown parent node", async () => {
    const { query } = makeQuery();
    expect(await query.childrenRollups(principalUser, "college", "col_ghost", YEAR)).toBeNull();
  });

  it("lists a college's departments with per-child served aggregates", async () => {
    const { repo, query } = makeQuery();
    await repo.replaceYear(YEAR, {
      attendance: [{
        scopeLevel: "department", nodeId: ORG.departmentId, ...paths.department,
        academicYear: YEAR, period: "YTD", sessions: 10, present: 90, absent: 10, late: 0, excused: 0, distinctStudents: 8,
      }],
      marks: [], flags: [],
    });
    const result = await query.childrenRollups(principalUser, "college", ORG.collegeId, YEAR);
    expect(result).not.toBeNull();
    expect(result!.childLevel).toBe("department");
    expect(result!.children).toHaveLength(1);
    expect(result!.children[0]!.name).toBe("Science");
    expect(result!.children[0]!.attendance.state).toBe("ok");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project unit packages/modules/analytics/src/service/query-service.test.ts`
Expected: FAIL with "childrenRollups is not a function".

- [ ] **Step 3: Implement `childrenRollups`**

In `query-service.ts`, add this method inside `class QueryService` (e.g. after `nodeMarks`, ~L384):

```ts
  /**
   * Per-child comparison under a node: college→departments, department→classes,
   * class→sections. Each child's aggregates are served through the same
   * closure + minimum-cohort path as a rollup, so out-of-scope children come
   * back as designed "denied" states, never errors.
   */
  async childrenRollups(
    principal: Principal,
    level: "college" | "department" | "class",
    nodeId: string,
    academicYear: string,
  ): Promise<{
    childLevel: ScopeLevel;
    children: {
      nodeId: string;
      name: string;
      attendance: AggState<AttendanceSummary> | { state: "denied" };
      marks: AggState<MarksSummary> | { state: "denied"; deniedSubjectId?: string };
      atRisk: number;
    }[];
  } | null> {
    if ((await this.nodePath(level, nodeId)) === null) {
      return null;
    }
    const childLevel: ScopeLevel =
      level === "college" ? "department" : level === "department" ? "class" : "section";
    const listed =
      level === "college"
        ? (await this.deps.directory.departmentsOfCollege(nodeId)).map((d) => ({ id: d.departmentId, name: d.name }))
        : level === "department"
          ? (await this.deps.directory.classesOfDepartment(nodeId)).map((c) => ({ id: c.classId, name: c.name }))
          : (await this.deps.directory.sectionsOfClass(nodeId)).map((s) => ({ id: s.sectionId, name: s.name }));

    const children = [];
    for (const child of listed) {
      const childNode = await this.nodePath(childLevel, child.id);
      if (childNode === null) continue;
      const attendance = await this.nodeAttendance(principal, child.id, childNode, academicYear);
      const marks = (await this.nodeMarks(principal, child.id, childNode, academicYear)).overall;
      const atRisk = (await this.atRisk(principal, childLevel, child.id, academicYear)).length;
      children.push({ nodeId: child.id, name: child.name, attendance, marks, atRisk });
    }
    return { childLevel, children };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project unit packages/modules/analytics/src/service/query-service.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/modules/analytics/src/service/query-service.ts packages/modules/analytics/src/service/query-service.test.ts
git commit -m "feat(analytics): QueryService.childrenRollups for cross-node comparison"
```

---

## Task 3: `QueryService.distribution` (histogram data)

**Files:**
- Modify: `packages/modules/analytics/src/service/query-service.ts`
- Test: `packages/modules/analytics/src/service/query-service.test.ts` (extend)

**Interfaces:**
- Consumes: existing `this.nodePath`, `this.studentPerformance`; `PeopleDirectory.sectionRoster/sectionsOfClass`; `cohortSufficient` (already imported).
- Produces: exported `interface Distribution { readonly total: number; readonly bands: readonly { label: string; count: number }[] }`; `QueryService.distribution(principal, level: "class" | "section", nodeId, academicYear)` returning `{ state: "not-found" } | { state: "ok"; marks: AggState<Distribution>; attendance: AggState<Distribution> }`.

- [ ] **Step 1: Write the failing test**

Append to `query-service.test.ts`:

```ts
describe("QueryService.distribution", () => {
  it("404s (not-found) for an unknown node", async () => {
    const { query } = makeQuery();
    const r = await query.distribution(principalUser, "section", "sec_ghost", YEAR);
    expect(r.state).toBe("not-found");
  });

  it("withholds a below-cohort marks distribution", async () => {
    const repo = new InMemoryRollupsRepo();
    const directory = new FakeDirectory();
    const read = new FakeAcademicsRead();
    // Roster of 3 students (< minCohort 5) on section A, each with one visible mark.
    directory.roster = [1, 2, 3].map((n) => ({ studentId: `stu_${n}`, academicYear: YEAR }));
    for (const n of [1, 2, 3]) {
      directory.positions.set(`stu_${n}`, paths.sectionA);
      read.marks.push({
        markId: `m_${n}`, studentId: `stu_${n}`, academicYear: YEAR, assessmentName: "T1",
        scorePct: 60, heldOn: "2026-06-10", recordedAt: "2026-06-10",
        position: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId, sectionId: ORG.sectionA, subjectId: ORG.mathId },
      });
    }
    const query = new QueryService({ repo, academicsRead: read, directory, scopeChecker: core.scopeChecker, minCohort: 5 });
    const r = await query.distribution(principalUser, "section", ORG.sectionA, YEAR);
    expect(r.state).toBe("ok");
    if (r.state === "ok") expect(r.marks.state).toBe("insufficient-cohort");
  });
});
```

> Note: confirm the `MarkRecordView` shape by opening `packages/modules/academics/src/` exports; adjust the literal above to match (`scorePct`, `assessmentName`, `heldOn`, `recordedAt`, `position`). The `studentPerformance` reader in `query-service.ts` (L305-354) shows exactly which fields it reads.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project unit packages/modules/analytics/src/service/query-service.test.ts`
Expected: FAIL with "distribution is not a function".

- [ ] **Step 3: Add band constants + the `Distribution` type**

In `query-service.ts`, near the top (after `const YTD = "YTD";`, L13) add:

```ts
export interface Distribution {
  readonly total: number;
  readonly bands: readonly { label: string; count: number }[];
}

const MARKS_BANDS = [
  { label: "0–40", lo: 0, hi: 40 },
  { label: "40–55", lo: 40, hi: 55 },
  { label: "55–70", lo: 55, hi: 70 },
  { label: "70–85", lo: 70, hi: 85 },
  { label: "85–100", lo: 85, hi: 100.0001 },
];
const ATT_BANDS = [
  { label: "<50", lo: 0, hi: 50 },
  { label: "50–75", lo: 50, hi: 75 },
  { label: "75–90", lo: 75, hi: 90 },
  { label: "≥90", lo: 90, hi: 100.0001 },
];
```

- [ ] **Step 4: Implement `distribution` + the private `bucket` helper**

In `query-service.ts`, add inside `class QueryService` (after `childrenRollups`):

```ts
  /**
   * A cohort node's marks/attendance histogram — COUNTS only, never
   * identifiable rows, withheld below the minimum cohort. Class or section
   * only; aggregate levels use childrenRollups (comparison) instead.
   */
  async distribution(
    principal: Principal,
    level: "class" | "section",
    nodeId: string,
    academicYear: string,
  ): Promise<
    { state: "not-found" } | { state: "ok"; marks: AggState<Distribution>; attendance: AggState<Distribution> }
  > {
    if ((await this.nodePath(level, nodeId)) === null) {
      return { state: "not-found" };
    }
    const studentIds = new Set<string>();
    if (level === "section") {
      for (const entry of await this.deps.directory.sectionRoster(nodeId)) studentIds.add(entry.studentId);
    } else {
      for (const section of await this.deps.directory.sectionsOfClass(nodeId)) {
        for (const entry of await this.deps.directory.sectionRoster(section.sectionId)) {
          studentIds.add(entry.studentId);
        }
      }
    }
    const marksVals: number[] = [];
    const attVals: number[] = [];
    for (const studentId of studentIds) {
      const perf = await this.studentPerformance(principal, studentId, academicYear);
      if (perf.state !== "ok") continue;
      if (perf.overallPct !== null) marksVals.push(perf.overallPct);
      if (perf.attendance !== null) attVals.push(perf.attendance.pct);
    }
    return {
      state: "ok",
      marks: this.bucket(marksVals, MARKS_BANDS),
      attendance: this.bucket(attVals, ATT_BANDS),
    };
  }

  private bucket(
    values: number[],
    bands: { label: string; lo: number; hi: number }[],
  ): AggState<Distribution> {
    if (values.length === 0) return { state: "no-data" };
    if (!cohortSufficient(values.length, this.deps.minCohort)) {
      return { state: "insufficient-cohort", minCohort: this.deps.minCohort };
    }
    return {
      state: "ok",
      value: {
        total: values.length,
        bands: bands.map((b) => ({ label: b.label, count: values.filter((v) => v >= b.lo && v < b.hi).length })),
      },
    };
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run --project unit packages/modules/analytics/src/service/query-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/modules/analytics/src/service/query-service.ts packages/modules/analytics/src/service/query-service.test.ts
git commit -m "feat(analytics): QueryService.distribution histogram (cohort-gated, counts only)"
```

---

## Task 4: Route specs + handlers for `compare` and `distribution`

**Files:**
- Modify: `packages/modules/analytics/src/definition.ts`
- Modify: `packages/modules/analytics/src/api/handlers.ts`
- Modify: `packages/modules/analytics/src/definition.test.ts` (if it enumerates route ids)
- Test: `packages/modules/analytics/src/api/handlers.test.ts` (extend)

**Interfaces:**
- Consumes: `QueryService.childrenRollups`, `QueryService.distribution` (Tasks 2-3); `deps.directory.namesFor`.
- Produces: routes `analytics.compare` (`GET /api/v1/analytics/compare/{level}/{nodeId}`) and `analytics.distribution` (`GET /api/v1/analytics/distribution/{level}/{nodeId}`), and their handlers in the returned map.

- [ ] **Step 1: Write the failing handler tests**

Append to `handlers.test.ts` (inside `describe("analytics handlers", ...)`):

```ts
  it("compare returns named children with served slots; 404 unknown parent", async () => {
    const { handlers } = await makeHarness();
    const principal = caller("p-1", ["principal"], [{ role: "principal", org: paths.college }]);
    const ok = await handlers["analytics.compare"]!(
      ctx(principal, { params: { level: "department", nodeId: ORG.departmentId }, query: { academicYear: YEAR } }),
    );
    expect(ok.status).toBe(200);
    const body = ok.body as { parent: { name: string }; childLevel: string; children: unknown[] };
    expect(body.parent.name).toBe("Science");
    expect(body.childLevel).toBe("class");
    expect(
      (await handlers["analytics.compare"]!(
        ctx(principal, { params: { level: "college", nodeId: "col_ghost" }, query: { academicYear: YEAR } }),
      )).status,
    ).toBe(404);
  });

  it("distribution 404s unknown nodes and returns histogram states", async () => {
    const { handlers } = await makeHarness();
    const principal = caller("p-2", ["principal"], [{ role: "principal", org: paths.college }]);
    expect(
      (await handlers["analytics.distribution"]!(
        ctx(principal, { params: { level: "section", nodeId: "sec_ghost" }, query: { academicYear: YEAR } }),
      )).status,
    ).toBe(404);
    const ok = await handlers["analytics.distribution"]!(
      ctx(principal, { params: { level: "class", nodeId: ORG.classId }, query: { academicYear: YEAR } }),
    );
    expect(ok.status).toBe(200);
    expect((ok.body as { marks: { state: string } }).marks.state).toBeDefined();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit packages/modules/analytics/src/api/handlers.test.ts`
Expected: FAIL (`handlers["analytics.compare"]` is undefined).

- [ ] **Step 3: Add schemas + route specs in `definition.ts`**

After `const yearQuery = ...` (L100) add:

```ts
const compareLevelSchema = z.enum(["college", "department", "class"]);
const distributionLevelSchema = z.enum(["class", "section"]);
const histogramSchema = z.object({
  total: z.number(),
  bands: z.array(z.object({ label: z.string(), count: z.number() })),
});
```

Inside the `routes` array, before the closing `]` (after the `analytics.recompute` spec, L223), add:

```ts
  {
    id: "analytics.compare",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/analytics/compare/{level}/{nodeId}",
    summary: "Compare a node's children (departments / classes / sections)",
    description:
      "Each child's attendance + overall marks are served through the same constituent-closure and minimum-cohort path as a rollup; children the caller can't read come back as designed 'denied' states, not errors.",
    tags: ["analytics"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ level: compareLevelSchema, nodeId: idSchema }), query: yearQuery },
    responses: {
      200: {
        description: "Per-child comparison",
        schema: z.object({
          parent: z.object({ level: compareLevelSchema, nodeId: z.string(), name: z.string() }),
          childLevel: scopeLevelSchema,
          children: z.array(
            z.object({
              nodeId: z.string(),
              name: z.string(),
              attendance: aggStateSchema(attendanceSummarySchema),
              marks: aggStateSchema(marksSummarySchema),
              atRisk: z.number(),
            }),
          ),
        }),
      },
      404: { description: "No such node", schema: problemSchema },
    },
  },
  {
    id: "analytics.distribution",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/analytics/distribution/{level}/{nodeId}",
    summary: "Marks/attendance distribution histogram (class or section)",
    description:
      "Server-side histogram COUNTS only (never identifiable rows), withheld below the minimum cohort. Class or section only — aggregate levels use /compare.",
    tags: ["analytics"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ level: distributionLevelSchema, nodeId: idSchema }), query: yearQuery },
    responses: {
      200: {
        description: "Distribution buckets",
        schema: z.object({
          node: z.object({ level: distributionLevelSchema, nodeId: z.string(), name: z.string() }),
          marks: aggStateSchema(histogramSchema),
          attendance: aggStateSchema(histogramSchema),
        }),
      },
      404: { description: "No such node", schema: problemSchema },
    },
  },
```

- [ ] **Step 4: Add handlers in `handlers.ts`**

Before the `return { ... }` map (L138), add:

```ts
  const compare: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { level: "college" | "department" | "class"; nodeId: string };
    const query = ctx.request.query as { academicYear: string };
    const result = await deps.query.childrenRollups(principal, params.level, params.nodeId, query.academicYear);
    if (result === null) {
      return notFound();
    }
    const names = await deps.directory.namesFor([params.nodeId]);
    return {
      status: 200,
      body: {
        parent: { level: params.level, nodeId: params.nodeId, name: names.get(params.nodeId) ?? params.nodeId },
        childLevel: result.childLevel,
        children: result.children,
      },
    };
  };

  const distribution: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { level: "class" | "section"; nodeId: string };
    const query = ctx.request.query as { academicYear: string };
    const result = await deps.query.distribution(principal, params.level, params.nodeId, query.academicYear);
    if (result.state === "not-found") {
      return notFound();
    }
    const names = await deps.directory.namesFor([params.nodeId]);
    return {
      status: 200,
      body: {
        node: { level: params.level, nodeId: params.nodeId, name: names.get(params.nodeId) ?? params.nodeId },
        marks: result.marks,
        attendance: result.attendance,
      },
    };
  };
```

Then add to the returned map (after `"analytics.recompute": recompute,`):

```ts
    "analytics.compare": compare,
    "analytics.distribution": distribution,
```

- [ ] **Step 5: Update `definition.test.ts` if it enumerates routes**

Open `packages/modules/analytics/src/definition.test.ts`. If it asserts an exhaustive route-id list or a route count, add `"analytics.compare"` and `"analytics.distribution"`. If it only checks individual ids, no change needed.

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm vitest run --project unit packages/modules/analytics`
Expected: PASS (handlers + definition + query-service).

- [ ] **Step 7: Regenerate the OpenAPI doc & typecheck**

Run: `set -a && source .env && set +a && pnpm openapi:generate && pnpm -r typecheck`
Expected: `docs/openapi/openapi.json` updated with the two routes; typecheck PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/modules/analytics/src/definition.ts packages/modules/analytics/src/api/handlers.ts packages/modules/analytics/src/definition.test.ts packages/modules/analytics/src/api/handlers.test.ts docs/openapi/openapi.json
git commit -m "feat(analytics): compare + distribution routes and handlers"
```

---

## Task 5: Next.js route files (web wiring)

**Files:**
- Create: `apps/web/app/api/v1/analytics/compare/[level]/[nodeId]/route.ts`
- Create: `apps/web/app/api/v1/analytics/distribution/[level]/[nodeId]/route.ts`

**Interfaces:**
- Consumes: `routeHandler` from `@/composition`; route ids `analytics.compare`, `analytics.distribution` (Task 4). Composition auto-binds any route in `analyticsModuleDefinition.routes`, so no `composition.ts` change is needed.

- [ ] **Step 1: Create the compare route file**

`apps/web/app/api/v1/analytics/compare/[level]/[nodeId]/route.ts`:

```ts
import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("analytics.compare");
```

- [ ] **Step 2: Create the distribution route file**

`apps/web/app/api/v1/analytics/distribution/[level]/[nodeId]/route.ts`:

```ts
import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("analytics.distribution");
```

- [ ] **Step 3: Smoke-test against the running stack**

Ensure web is running (`pnpm dev` with env loaded) and demo seeded + recomputed. Then:

```bash
cd d:/ATLAS && set -a && source .env && set +a
COOKIE=$(curl -s -i -X POST http://localhost:3000/api/v1/identity/auth/login -H 'content-type: application/json' -d '{"username":"demo-principal","password":"demo-staff-pass-2026!"}' | grep -i '^set-cookie:' | sed -E 's/set-cookie: (vidya_session=[^;]*).*/\1/i' | tr -d '\r')
COL=$(curl -s -H "cookie: $COOKIE" http://localhost:3000/api/v1/analytics/dashboard?academicYear=2026-27 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s).tiles[0];console.log(t.collegeId)})")
curl -s -H "cookie: $COOKIE" "http://localhost:3000/api/v1/analytics/compare/college/$COL?academicYear=2026-27" | head -c 400; echo
```
Expected: JSON with `parent`, `childLevel: "department"`, and a `children` array.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/v1/analytics/compare apps/web/app/api/v1/analytics/distribution
git commit -m "feat(web): route files for analytics compare + distribution"
```

---

## Task 6: Web API client methods + types

**Files:**
- Modify: `apps/web/src/ui/api.ts`

**Interfaces:**
- Produces: types `NodeRollup`, `ComparisonReport`, `ComparisonChild`, `HistogramBand`, `DistributionResponse`; `api.rollup(level, nodeId, year)`, `api.compare(level, nodeId, year)`, `api.distribution(level, nodeId, year)`.

- [ ] **Step 1: Add the types**

In `api.ts`, after the `StudentPerformance` interface (L115) add:

```ts
export interface NodeRollup {
  node: { level: string; nodeId: string; name: string };
  attendance: AggState<AttendanceSummary>;
  marks: {
    bySubject: { subjectId: string; name: string; summary: AggState<MarksSummary> }[];
    overall: AggState<MarksSummary>;
  };
}

export interface ComparisonChild {
  nodeId: string;
  name: string;
  attendance: AggState<AttendanceSummary>;
  marks: AggState<MarksSummary>;
  atRisk: number;
}
export interface ComparisonReport {
  parent: { level: string; nodeId: string; name: string };
  childLevel: string;
  children: ComparisonChild[];
}

export interface HistogramBand {
  label: string;
  count: number;
}
export interface DistributionResponse {
  node: { level: string; nodeId: string; name: string };
  marks: AggState<{ total: number; bands: HistogramBand[] }>;
  attendance: AggState<{ total: number; bands: HistogramBand[] }>;
}
```

- [ ] **Step 2: Add the API methods**

In the `api` object (after `studentPerformance`, L152) add:

```ts
  rollup: (level: string, nodeId: string, year: string) =>
    get<NodeRollup>(`/api/v1/analytics/rollups/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`),
  compare: (level: string, nodeId: string, year: string) =>
    get<ComparisonReport>(`/api/v1/analytics/compare/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`),
  distribution: (level: string, nodeId: string, year: string) =>
    get<DistributionResponse>(`/api/v1/analytics/distribution/${level}/${encodeURIComponent(nodeId)}?academicYear=${year}`),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @vidya/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/ui/api.ts
git commit -m "feat(web): api client methods for rollup, compare, distribution"
```

---

## Task 7: Chart primitives (`TrendLine`, `CompareBars`, `Histogram`, `RiskDonut`)

**Files:**
- Modify: `apps/web/src/ui/charts.tsx`
- Test: `apps/web/src/ui/charts.test.tsx` (create)

**Interfaces:**
- Produces: `TrendLine({ points, label, height? })`, `CompareBars({ rows })` where `rows: { label: string; attendancePct: number | null; marksPct: number | null; atRisk: number }[]`, `Histogram({ bands, label, accent? })` where `bands: { label: string; count: number }[]`, `RiskDonut({ segments, total, label })` where `segments: { label: string; value: number; tone: string }[]`.

- [ ] **Step 1: Write the failing render tests**

Create `charts.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendLine, CompareBars, Histogram, RiskDonut } from "./charts";

describe("chart primitives", () => {
  it("TrendLine renders an accessible titled line", () => {
    render(<TrendLine label="Attendance trend" points={[{ x: "2026-06", y: 80 }, { x: "2026-07", y: 88 }]} />);
    expect(screen.getByRole("img", { name: /Attendance trend/ })).toBeInTheDocument();
  });
  it("CompareBars lists each child with its figures", () => {
    render(<CompareBars rows={[{ label: "Computer Science", attendancePct: 86, marksPct: 74, atRisk: 1 }]} />);
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
  });
  it("Histogram summarises bands in its aria-label", () => {
    render(<Histogram label="Marks distribution" bands={[{ label: "0–40", count: 2 }, { label: "40–55", count: 3 }]} />);
    expect(screen.getByRole("img", { name: /Marks distribution/ })).toBeInTheDocument();
  });
  it("RiskDonut shows the total and segment legend", () => {
    render(<RiskDonut label="At risk" total={2} segments={[{ label: "low attendance", value: 1, tone: "var(--series-1)" }, { label: "both", value: 1, tone: "var(--series-2)" }]} />);
    expect(screen.getByText("low attendance")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project ui apps/web/src/ui/charts.test.tsx`
Expected: FAIL (exports not found).

- [ ] **Step 3: Append the four components to `charts.tsx`**

Add at the end of `charts.tsx`:

```tsx
/** A titled multi-month line with an axis (bigger sibling of Sparkline). */
export function TrendLine({
  points,
  label,
  height = 160,
}: {
  points: { x: string; y: number }[];
  label: string;
  height?: number;
}) {
  if (points.length === 0) return <div className="strip-empty">No trend yet.</div>;
  const w = 640;
  const h = height;
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const n = points.length;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const xFor = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const yFor = (v: number) => padT + (1 - Math.max(0, Math.min(100, v)) / 100) * innerH;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${xFor(n - 1).toFixed(1)},${padT + innerH} L${xFor(0).toFixed(1)},${padT + innerH} Z`;
  const summary = points.map((p) => `${p.x}: ${p.y}%`).join(", ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${label}. ${summary}`}>
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={padL} y1={yFor(g)} x2={w - padR} y2={yFor(g)} stroke="var(--rule)" strokeWidth="1" opacity="0.6" />
          <text x={padL - 6} y={yFor(g) + 3} textAnchor="end" fontSize="10" fill="var(--muted, #8a8a8a)">{g}</text>
        </g>
      ))}
      <path d={area} fill="var(--line)" opacity="0.1" />
      <path d={line} fill="none" stroke="var(--line)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={`pt-${i}`} cx={xFor(i)} cy={yFor(p.y)} r="2.6" fill="var(--line)" />
      ))}
      {points.map((p, i) =>
        i === 0 || i === n - 1 || n <= 6 ? (
          <text key={`lb-${i}`} x={xFor(i)} y={h - 8} textAnchor="middle" fontSize="10" fill="var(--muted, #8a8a8a)">
            {p.x}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Per-child comparison: one row each, an attendance bar and a marks bar. */
export function CompareBars({
  rows,
}: {
  rows: { label: string; attendancePct: number | null; marksPct: number | null; atRisk: number }[];
}) {
  if (rows.length === 0) return <div className="strip-empty">Nothing to compare in your scope yet.</div>;
  return (
    <div role="table" aria-label="Comparison across areas">
      {rows.map((row, index) => (
        <div
          role="row"
          key={`${row.label}-${index}`}
          style={{ display: "grid", gridTemplateColumns: "150px 1fr auto", gap: 14, alignItems: "center", padding: "10px 0", borderTop: index === 0 ? "none" : "1px solid var(--rule)" }}
        >
          <span role="rowheader" title={row.label} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.label}
          </span>
          <span role="cell" style={{ display: "grid", gap: 6 }}>
            <CompareMiniBar tag="attend" value={row.attendancePct} tone="var(--series-1)" />
            <CompareMiniBar tag="marks" value={row.marksPct} tone="var(--series-2)" />
          </span>
          <span role="cell" className={`risk-count${row.atRisk === 0 ? " clear" : ""}`} style={{ whiteSpace: "nowrap" }}>
            <span className="risk-dot" aria-hidden="true" />
            {row.atRisk === 0 ? "on track" : `${row.atRisk} at risk`}
          </span>
        </div>
      ))}
    </div>
  );
}

function CompareMiniBar({ tag, value, tone }: { tag: string; value: number | null; tone: string }) {
  if (value === null) {
    return <span className="num" style={{ fontSize: 12, opacity: 0.55 }}>{tag}: withheld</span>;
  }
  return (
    <span style={{ display: "grid", gridTemplateColumns: "50px 1fr 44px", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 11, opacity: 0.7 }}>{tag}</span>
      <span style={{ height: 8, borderRadius: 4, background: "var(--rule)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.max(2, Math.min(100, value))}%`, background: tone }} />
      </span>
      <span className="num" style={{ fontSize: 12, textAlign: "right" }}>{value.toFixed(0)}%</span>
    </span>
  );
}

/** Vertical count bars for distribution bands. */
export function Histogram({
  bands,
  label,
  accent = "var(--series-3)",
}: {
  bands: { label: string; count: number }[];
  label: string;
  accent?: string;
}) {
  if (bands.length === 0) return <div className="strip-empty">No distribution to show.</div>;
  const w = 440;
  const h = 160;
  const padT = 12;
  const padB = 28;
  const gap = 12;
  const max = Math.max(1, ...bands.map((b) => b.count));
  const bw = (w - gap * (bands.length - 1)) / bands.length;
  const summary = bands.map((b) => `${b.label}: ${b.count}`).join(", ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${label}. ${summary}`}>
      {bands.map((b, i) => {
        const bh = (b.count / max) * (h - padT - padB);
        const x = i * (bw + gap);
        const y = h - padB - bh;
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={bw} height={bh} rx="3" fill={accent} opacity={b.count === 0 ? 0.15 : 0.85} />
            {b.count > 0 ? (
              <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize="11" fill="var(--line)">{b.count}</text>
            ) : null}
            <text x={x + bw / 2} y={h - 9} textAnchor="middle" fontSize="10" fill="var(--muted, #8a8a8a)">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** At-risk composition donut with a centre total and a direct legend. */
export function RiskDonut({
  segments,
  total,
  label,
}: {
  segments: { label: string; value: number; tone: string }[];
  total: number;
  label: string;
}) {
  const size = 160;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  const sum = segments.reduce((acc, s) => acc + s.value, 0);
  const summary = segments.map((s) => `${s.label}: ${s.value}`).join(", ");
  let offset = 0;
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${label}. ${summary}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--rule)" strokeWidth={stroke} />
        {sum > 0 &&
          segments.map((s) => {
            const len = (s.value / sum) * c;
            const node = (
              <circle
                key={s.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.tone}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            );
            offset += len;
            return node;
          })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="30" fontWeight="700" fill="var(--line)">{total}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize="11" fill="var(--muted, #8a8a8a)">at risk</text>
      </svg>
      <div style={{ display: "grid", gap: 7 }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.tone }} aria-hidden="true" />
            {s.label} <span className="num" style={{ opacity: 0.7 }}>{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run --project ui apps/web/src/ui/charts.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/charts.tsx apps/web/src/ui/charts.test.tsx
git commit -m "feat(web): TrendLine, CompareBars, Histogram, RiskDonut chart primitives"
```

---

## Task 8: Redesign `/dashboard` (compose the graphs, role-adaptive)

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`
- Modify: `apps/web/src/ui/dashboard.test.tsx` (extend mocks + assertions)

**Interfaces:**
- Consumes: `api.dashboard`, `api.atRisk`, `api.rollup`, `api.compare`, `api.distribution` (Task 6); `TrendLine`, `CompareBars`, `Histogram`, `RiskDonut`, `StatTile`, `SubjectBars`, `RegisterStrip` (Task 7 + existing).

- [ ] **Step 1: Add a focus-node helper + fetch logic (write the code)**

Replace the body of `apps/web/app/dashboard/page.tsx` with the version below. It keeps the existing session/at-risk logic and adds: pick the highest-precedence tile as the "focus node", fetch its `rollup` (marks-by-subject), `compare` (if college/department/class), and `distribution` (if a class-level tile), then render the graph sections. Withheld/denied states render designed messages.

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  currentAcademicYear,
  type AtRiskEntry,
  type ComparisonReport,
  type Dashboard,
  type DistributionResponse,
  type NodeRollup,
  type Session,
  type Tile,
} from "@/ui/api";
import { Masthead } from "@/ui/Masthead";
import {
  AttendanceSlot,
  CompareBars,
  Histogram,
  MarksSlot,
  RegisterStrip,
  RiskDonut,
  StatTile,
  SubjectBars,
  TrendLine,
} from "@/ui/charts";

export const dynamic = "force-dynamic";

type Focus = { level: "college" | "department" | "class"; nodeId: string; classId?: string; tile: Tile };

const PRECEDENCE: Record<Tile["type"], number> = {
  college: 4,
  department: 3,
  class: 2,
  "teacher-class": 1,
};

function focusOf(tiles: Tile[]): Focus | null {
  if (tiles.length === 0) return null;
  const tile = [...tiles].sort((a, b) => PRECEDENCE[b.type] - PRECEDENCE[a.type])[0]!;
  switch (tile.type) {
    case "college":
      return { level: "college", nodeId: tile.collegeId, tile };
    case "department":
      return { level: "department", nodeId: tile.departmentId, tile };
    case "class":
      return { level: "class", nodeId: tile.classId, classId: tile.classId, tile };
    case "teacher-class":
      return { level: "class", nodeId: tile.classId, classId: tile.classId, tile };
  }
}

function riskSegments(entries: AtRiskEntry[]): { label: string; value: number; tone: string }[] {
  let attOnly = 0;
  let marksOnly = 0;
  let both = 0;
  for (const entry of entries) {
    const a = entry.reasons.includes("low-attendance");
    const m = entry.reasons.includes("low-marks");
    if (a && m) both += 1;
    else if (a) attOnly += 1;
    else if (m) marksOnly += 1;
  }
  return [
    { label: "low attendance", value: attOnly, tone: "var(--series-1)" },
    { label: "low marks", value: marksOnly, tone: "var(--series-2)" },
    { label: "both", value: both, tone: "var(--series-5)" },
  ];
}

export default function DashboardPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskEntry[]>([]);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [rollup, setRollup] = useState<NodeRollup | null>(null);
  const [compare, setCompare] = useState<ComparisonReport | null>(null);
  const [distribution, setDistribution] = useState<DistributionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.session();
        if (!alive) return;
        setSession(me);
        const dash = await api.dashboard(year);
        if (!alive) return;
        setDashboard(dash);

        const seen = new Map<string, AtRiskEntry>();
        for (const tile of dash.tiles) {
          const level =
            tile.type === "department" ? "department" : tile.type === "college" ? "college" : "class";
          const nodeId =
            tile.type === "department" ? tile.departmentId : tile.type === "college" ? tile.collegeId : tile.classId;
          try {
            const result = await api.atRisk(level, nodeId, year);
            for (const entry of result.students) if (!seen.has(entry.studentId)) seen.set(entry.studentId, entry);
          } catch {
            /* a node the caller cannot enumerate is skipped */
          }
        }
        if (alive) {
          setAtRisk([...seen.values()].sort((a, b) => (a.attendancePct ?? 100) - (b.attendancePct ?? 100)));
        }

        const f = focusOf(dash.tiles);
        if (alive) setFocus(f);
        if (f) {
          try {
            if (alive) setRollup(await api.rollup(f.level, f.nodeId, year));
          } catch {
            /* rollup optional */
          }
          try {
            if (alive) setCompare(await api.compare(f.level, f.nodeId, year));
          } catch {
            /* comparison optional */
          }
          if (f.classId) {
            try {
              if (alive) setDistribution(await api.distribution("class", f.classId, year));
            } catch {
              /* distribution optional */
            }
          }
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (alive) setError("Something went wrong loading your dashboard. Try again shortly.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [year]);

  if (error !== null) {
    return (
      <>
        <Masthead year={year} />
        <main id="main" className="page"><div className="state">{error}</div></main>
      </>
    );
  }
  if (dashboard === null || session === null) {
    return (
      <>
        <Masthead year={year} />
        <main id="main" className="page"><p className="page-lede">Opening the register…</p></main>
      </>
    );
  }

  const names = dashboard.names;
  const focusTile = focus?.tile ?? null;
  const kpiAttendance = focusTile && "attendance" in focusTile ? focusTile.attendance : null;
  const kpiMarks = focusTile && "marks" in focusTile ? focusTile.marks : null;
  const cohort =
    kpiAttendance && kpiAttendance.state === "ok" ? kpiAttendance.value.distinctStudents : null;

  return (
    <>
      <Masthead who={session.displayName} year={year} />
      <main id="main" className="page">
        <p className="eyebrow">{session.roles.join(" · ")}</p>
        <h1 className="page-title">Good day, {session.displayName.split(" ")[0]}.</h1>
        <p className="page-lede">
          Every figure here is drawn only from records you're allowed to read. Rooms outside your scope simply
          don't appear.
        </p>

        {dashboard.tiles.length === 0 ? (
          <div className="state">
            <strong>Nothing to show yet.</strong> Once an administrator assigns you a class, subject or area,
            your register appears here.
          </div>
        ) : (
          <>
            {/* KPI ROW */}
            <section className="stats" aria-label="Key figures" style={{ marginBottom: 24 }}>
              {kpiAttendance ? <AttendanceSlot slot={kpiAttendance} /> : null}
              {kpiMarks ? <MarksSlot slot={kpiMarks} /> : null}
              <StatTile value={String(atRisk.length)} label="Students at risk" />
              <StatTile value={cohort === null ? "—" : String(cohort)} label="Students in scope" muted={cohort === null} />
            </section>

            {/* ATTENDANCE TREND */}
            {kpiAttendance && kpiAttendance.state === "ok" && kpiAttendance.value.monthly.length > 0 ? (
              <section className="section" aria-label="Attendance trend">
                <div className="section-head"><h2>Attendance trend</h2></div>
                <div className="card">
                  <TrendLine
                    label="Monthly attendance"
                    points={kpiAttendance.value.monthly.map((m) => ({ x: m.month, y: m.pct }))}
                  />
                </div>
              </section>
            ) : null}

            {/* MARKS BY SUBJECT */}
            {rollup && rollup.marks.bySubject.length > 0 ? (
              <section className="section" aria-label="Marks by subject">
                <div className="section-head">
                  <h2>Marks by subject</h2>
                  <span className="stat-sub num">{rollup.marks.bySubject.length} visible</span>
                </div>
                <div className="card">
                  <SubjectBars
                    rows={rollup.marks.bySubject.map((s, index) => ({
                      label: s.name,
                      value: s.summary.state === "ok" ? s.summary.value.avgPct : 0,
                      index,
                    }))}
                  />
                </div>
              </section>
            ) : null}

            {/* COMPARISON */}
            {compare && compare.children.length > 0 ? (
              <section className="section" aria-label="Comparison">
                <div className="section-head">
                  <h2>Comparison — {compare.childLevel === "department" ? "departments" : compare.childLevel === "class" ? "classes" : "sections"}</h2>
                </div>
                <div className="card">
                  <CompareBars
                    rows={compare.children.map((child) => ({
                      label: child.name,
                      attendancePct: child.attendance.state === "ok" ? child.attendance.value.pct : null,
                      marksPct: child.marks.state === "ok" ? child.marks.value.avgPct : null,
                      atRisk: child.atRisk,
                    }))}
                  />
                </div>
              </section>
            ) : null}

            {/* MARKS DISTRIBUTION */}
            {distribution ? (
              <section className="section" aria-label="Marks distribution">
                <div className="section-head"><h2>Marks distribution</h2></div>
                <div className="card">
                  {distribution.marks.state === "ok" ? (
                    <Histogram label="Overall marks distribution" bands={distribution.marks.value.bands} />
                  ) : (
                    <div className="strip-empty">
                      {distribution.marks.state === "insufficient-cohort"
                        ? `Cohort too small to summarise (under ${distribution.marks.minCohort}).`
                        : "No distribution yet."}
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {/* AT-RISK DONUT + REGISTER STRIP */}
            {atRisk.length > 0 ? (
              <section className="section" aria-label="At-risk composition">
                <div className="section-head"><h2>Risk composition</h2></div>
                <div className="card">
                  <RiskDonut label="At-risk composition" total={atRisk.length} segments={riskSegments(atRisk)} />
                </div>
              </section>
            ) : null}

            {focusTile && (focusTile.type === "class" || focusTile.type === "teacher-class") && focusTile.strip.length > 0 ? (
              <section className="section" aria-label="Register">
                <div className="section-head"><h2>The register</h2></div>
                <div className="card"><RegisterStrip sections={focusTile.strip} /></div>
              </section>
            ) : null}
          </>
        )}

        {/* NEEDS ATTENTION (unchanged list) */}
        <section className="section" aria-label="Students who need attention">
          <div className="section-head">
            <h2>Needs attention</h2>
            <span className="stat-sub num">{atRisk.length} flagged</span>
          </div>
          {atRisk.length === 0 ? (
            <div className="state">
              <strong>No one is flagged.</strong> Students appear here when attendance or marks fall below the
              thresholds — nothing to chase right now.
            </div>
          ) : (
            <div className="card">
              {atRisk.map((entry) => (
                <div className="risk-row" key={entry.studentId}>
                  <div>
                    <a className="risk-name" href={`/students/${encodeURIComponent(entry.studentId)}`}>{entry.name}</a>
                    <div className="risk-reasons" style={{ marginTop: 6 }}>
                      {entry.reasons.includes("low-attendance") ? <span className="chip serious">low attendance</span> : null}
                      {entry.reasons.includes("low-marks") ? <span className="chip serious">low marks</span> : null}
                    </div>
                  </div>
                  <div className="risk-figs">
                    {entry.attendancePct !== null ? (<span><span className="k">attend</span>{entry.attendancePct}%</span>) : null}
                    {entry.overallPct !== null ? (<span><span className="k">overall</span>{entry.overallPct}%</span>) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Extend the dashboard test with the new mocks**

In `apps/web/src/ui/dashboard.test.tsx`, add `rollup`, `compare`, `distribution` to the `vi.mock` `api` object and default them in `beforeEach` so existing tests keep passing:

```tsx
// in vi.mock api object:
api: { ...actual.api, session: vi.fn(), dashboard: vi.fn(), atRisk: vi.fn(), logout: vi.fn(),
  rollup: vi.fn(), compare: vi.fn(), distribution: vi.fn() },
```

```tsx
// add to beforeEach:
(api.rollup as ReturnType<typeof vi.fn>).mockResolvedValue({
  node: { level: "class", nodeId: "class-se-a", name: "SE-A" },
  attendance: { state: "ok", value: { pct: 88, sessions: 40, distinctStudents: 30, monthly: [] } },
  marks: { bySubject: [{ subjectId: "sub-ds", name: "Data Structures", summary: { state: "ok", value: { avgPct: 72, nMarks: 10, distinctStudents: 30, monthly: [] } } }], overall: { state: "no-data" } },
});
(api.compare as ReturnType<typeof vi.fn>).mockResolvedValue({
  parent: { level: "class", nodeId: "class-se-a", name: "SE-A" },
  childLevel: "section",
  children: [{ nodeId: "sec-a", name: "A", attendance: { state: "ok", value: { pct: 88, sessions: 40, distinctStudents: 30, monthly: [] } }, marks: { state: "no-data" }, atRisk: 1 }],
});
(api.distribution as ReturnType<typeof vi.fn>).mockResolvedValue({
  node: { level: "class", nodeId: "class-se-a", name: "SE-A" },
  marks: { state: "insufficient-cohort", minCohort: 5 },
  attendance: { state: "ok", value: { total: 30, bands: [{ label: "75–90", count: 20 }, { label: "≥90", count: 10 }] } },
});
```

Add one new assertion:

```tsx
  it("shows the comparison section built from api.compare", async () => {
    render(<DashboardPage />);
    expect(await screen.findByText(/Comparison —/)).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run the UI tests**

Run: `pnpm vitest run --project ui apps/web/src/ui/dashboard.test.tsx`
Expected: PASS (existing 4 + new 1).

- [ ] **Step 4: Typecheck the web app**

Run: `pnpm --filter @vidya/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/page.tsx apps/web/src/ui/dashboard.test.tsx
git commit -m "feat(web): multi-graph role-adaptive dashboard"
```

---

## Task 9: Enrich the demo seeder

**Files:**
- Modify: `scripts/seed-demo.ts`

**Interfaces:**
- Consumes: nothing new — same real scoped chain. Changes cohort sizes, assessment count, and the attendance date span.

> **Design note (academic-year window):** at the demo date (2026-07-06) the current AY (2026-27) is only ~2 months old (it rolls over in June), so attendance spans **June–July 2026** — two monthly trend points. The marquee graphs (comparison, histogram, marks-by-subject, per-assessment series, at-risk) fill richly regardless. A longer multi-month attendance *trend* would require seeding the prior AY (2025-26) and viewing it — out of scope for round 1.

- [ ] **Step 1: Widen the attendance window to all June–July weekdays**

In `seed-demo.ts`, replace `attendanceDays` (L559-568) with:

```ts
/** Every weekday from 2026-06-01 to the demo anchor 2026-07-06 (AY 2026-27). */
function attendanceDays(): string[] {
  const days: string[] = [];
  const cursor = new Date("2026-06-01T00:00:00Z");
  const end = new Date("2026-07-06T00:00:00Z");
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
```

Then update the call site (L434) from `const days = attendanceDays(10);` to `const days = attendanceDays();`.

- [ ] **Step 2: Enlarge the cohorts**

In the `DEPARTMENTS` constant, replace the CSE `students` array (L74-77) with 14 names and the ECE `students` array (L95) with 10 names:

```ts
        students: [
          "Aarav Sharma", "Diya Patel", "Kabir Singh", "Meera Iyer",
          "Rohan Gupta", "Saanvi Reddy", "Ishaan Khan", "Ananya Bose",
          "Vivaan Joshi", "Aditi Rao", "Arnav Mehta", "Kavya Nair",
          "Reyansh Shah", "Myra Kapoor",
        ],
```

```ts
        students: ["Tara Mehta", "Yash Chauhan", "Nisha Pillai", "Arjun Nair", "Zara Sheikh", "Dev Malhotra", "Ira Sinha", "Neel Verma", "Riya Das", "Om Bhat"],
```

- [ ] **Step 3: Add more assessments per subject**

In the marks loop, replace the two-assessment array (L452-455) with five:

```ts
          for (const assessment of [
            { kind: "quiz" as const, name: "Quiz 1", maxScore: 10 },
            { kind: "quiz" as const, name: "Unit Test 1", maxScore: 20 },
            { kind: "exam" as const, name: "Assignment 1", maxScore: 25 },
            { kind: "exam" as const, name: "Midterm", maxScore: 100 },
            { kind: "quiz" as const, name: "Quiz 2", maxScore: 10 },
          ]) {
```

- [ ] **Step 4: Re-seed a clean database and recompute**

The seeder is idempotent only past the org tree; to reseed the enriched data, truncate app tables (keep `platform_migrations`, `sys_audit_log`) then run the seeder and recompute:

```bash
cd d:/ATLAS && set -a && source .env && set +a
node -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();const keep=new Set(['platform_migrations','sys_audit_log']);const{rows}=await c.query(\"select tablename from pg_tables where schemaname='public'\");const t=rows.map(r=>r.tablename).filter(x=>!keep.has(x)).map(x=>'\"'+x+'\"').join(', ');await c.query('TRUNCATE '+t+' RESTART IDENTITY CASCADE');console.log('truncated');await c.end();})()"
NODE_ENV=development VIDYA_ALLOW_DEMO_SEED=true node_modules/.bin/tsx scripts/seed-demo.ts
```

Then log in as admin and recompute (worker rebuilds rollups):

```bash
COOKIE=$(curl -s -i -X POST http://localhost:3000/api/v1/identity/auth/login -H 'content-type: application/json' -d '{"username":"demo-admin","password":"demo-admin-pass-2026!"}' | grep -i '^set-cookie:' | sed -E 's/set-cookie: (vidya_session=[^;]*).*/\1/i' | tr -d '\r')
curl -s -X POST http://localhost:3000/api/v1/analytics/recompute -H 'content-type: application/json' -H "cookie: $COOKIE" -d '{"academicYear":"2026-27"}'
```
Expected: seeder prints the credential table; recompute returns `{"enqueued":true}`; worker log shows `rollup rebuild finished` with non-zero `rollups`/`flags`.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-demo.ts
git commit -m "feat(seed): enrich demo dataset (June–July span, larger cohorts, 5 assessments)"
```

---

## Task 10: Full-suite gate + Playwright visual verification

**Files:**
- Use: `C:/Users/DELL/AppData/Local/Temp/claude/d--ATLAS/<session>/scratchpad/drive.mjs` (existing per-role screenshotter) or a fresh copy.

- [ ] **Step 1: Run the whole unit + ui suite and lint/typecheck**

```bash
cd d:/ATLAS && set -a && source .env && set +a
pnpm -r typecheck && pnpm lint && pnpm test && pnpm test:ui
```
Expected: all PASS. Fix any failure before continuing.

- [ ] **Step 2: Drive the dashboard per role and screenshot**

With web + worker running and the enriched seed recomputed, run the Playwright driver (login as `demo-principal`, `demo-hod-cse`, `demo-ct-fycs`, `demo-teacher-ds`; screenshot `/dashboard` each). Reuse the driver from the run session; it resolves `playwright` via `createRequire` from the npx cache.

Run: `node <scratchpad>/drive.mjs`
Expected: `dash-*.png` for each role.

- [ ] **Step 3: Look at each screenshot and confirm**

Open each PNG and verify: KPI row, attendance trend, marks-by-subject, comparison bars (principal→departments, HoD→classes, teacher→sections), marks histogram (class-level roles), risk donut, register heatmap (class roles), and that out-of-scope rooms never appear. Withheld states must read as designed messages, not blanks or crashes.

- [ ] **Step 4: Final commit (if any screenshot-driven tweaks were needed)**

```bash
git add -A
git commit -m "chore: analytics dashboard visual verification pass"
```

---

## Self-Review

- **Spec coverage:** §1 backend endpoints → Tasks 2-5; §2 charts → Task 7; §3 dashboard + role matrix → Task 8; §4 data flow/errors → Tasks 4-6, 8 (withheld states); §5 seed enrichment → Task 9; testing/verification → each task's tests + Task 10. Directory dependency (spec §A "extend PeopleDirectory") → Task 1.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; the one open literal (`MarkRecordView` fields in Task 3 Step 1) is called out with the exact source to confirm against.
- **Type consistency:** `childrenRollups`/`distribution` signatures in Tasks 2-3 match their handler calls in Task 4 and client types in Task 6; `Distribution`, `ComparisonReport`, `NodeRollup`, `HistogramBand` names are used identically across tasks; `AggState` reused from both `query-service.ts` (server) and `api.ts` (client).
- **Known tradeoff:** attendance trend spans two months at the demo date (Task 9 note); marquee graphs are unaffected.
