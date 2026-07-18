# Syllabus Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `@vidya/module-syllabus`: subject-teacher-authored units→topics per class·subject·year, with per-topic coverage (a `taught_on` date), staff read (row-filtered by subject scope), and a read-only student portal view.

**Architecture:** A compact feature module modeled 1:1 on `@vidya/module-coursework` (`definition.ts` / `handlers.ts` / `repo.ts` / `db/schema.ts` / `index.ts` / conformance `definition.test.ts` + `handlers.test.ts`). Uses the `PeopleDirectory` port for class/subject/student resolution and the existing `ScopeChecker` teacher subject-write grant (NO scope-checker change). No jobs, no object storage.

**Tech Stack:** TypeScript strict, Drizzle/Postgres, Zod, `@vidya/platform` (RouteSpec/RuntimeModule/ScopeChecker), Next.js App Router (`apps/web`), vitest (unit/ui/integration), pnpm workspaces.

## Global Constraints

- Ponytail: smallest change that fully works; reuse before build; **no new runtime deps** (ADR-0009).
- **The reference module is `packages/modules/coursework`** — mirror its file layout, factory shape, `resolveTarget`/`teacherAllowed` idiom, and row-filtered class read. When this plan says "mirror coursework's X", read that exact code and adapt the named deltas.
- **NO ScopeChecker / grant-matrix change.** Writes carry `subjectId`+org and go through `teacherAllowed(principal, path, subjectId)` (existing `teacher` grant). If a task finds it cannot proceed without touching `packages/modules/identity/src/core/scope-checker.ts` or the conformance matrix, STOP and flag the owner.
- Table prefix **`syl_`** (enforced by `pnpm check:ownership`). All tables + `pgTable()` names start with it.
- Module id / name: **`syllabus`**; routes versioned `/api/v1/syllabus/…`.
- Coverage is a **date** (`taught_on`, nullable); `taught_by` = identity user id, set/cleared together with `taught_on`. Coverage % is **derived, never stored**.
- Anchoring per `(collegeId, departmentId, classId, subjectId, teacherId, academicYear)`.
- Register a new module in **exactly three places** (`docs/how-to-add-a-module.md`): `scripts/registry.ts`, `apps/web/src/composition.ts` (+ one thin route file per route), `apps/worker/src/main.ts`; plus the `@vidya/module-syllabus` workspace dep in `apps/web/package.json` and `apps/worker/package.json`.
- State-changing routes MUST declare `audit: { action, resourceType }` (defineRoute refuses otherwise). Non-public auth unless justified.
- Five UI states; both themes from tokens; `:focus-visible`; `prefers-reduced-motion`; honest empty/withheld/403.
- After routes: `pnpm openapi:generate`. Verify: `pnpm typecheck`, `pnpm lint`, `pnpm check:ownership`, `pnpm --filter @vidya/web build`. Test env vars (bash) per `docs/NEXT-SESSION.md`.

---

### Task 1: Package scaffold + schema + migration + repo

**Files:**
- Create: `packages/modules/syllabus/package.json`, `tsconfig.json`
- Create: `packages/modules/syllabus/migrations/0000_syllabus.sql` + `0000_syllabus.down.sql`
- Create: `packages/modules/syllabus/src/db/schema.ts`
- Create: `packages/modules/syllabus/src/repo.ts`
- Test: `packages/modules/syllabus/src/repo.test.ts` (coverage-rollup pure logic)

**Interfaces:**
- Produces: drizzle tables `sylUnits`, `sylTopics` (+ `SylUnitRow`, `SylTopicRow`); `SyllabusRepo` with methods listed below; `createSyllabusRepo(db)`.

- [ ] **Step 1: package.json + tsconfig** — copy `packages/modules/coursework/package.json` and `tsconfig.json`, rename to `@vidya/module-syllabus`. Keep `exports`, deps (`@vidya/platform: workspace:*`, `drizzle-orm`, `zod`). tsconfig extends `../../../tsconfig.base.json`.

- [ ] **Step 2: Write the migration pair**

`0000_syllabus.sql`:
```sql
-- Module: syllabus — units + topics with per-topic coverage (taught_on date).
CREATE TABLE syl_units (
  id            text PRIMARY KEY,
  college_id    text NOT NULL,
  department_id text NOT NULL,
  class_id      text NOT NULL,
  subject_id    text NOT NULL,
  teacher_id    text NOT NULL,
  academic_year text NOT NULL,
  title         text NOT NULL,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX syl_unit_title_uq ON syl_units (class_id, subject_id, academic_year, title);
CREATE INDEX syl_unit_class_idx ON syl_units (class_id, academic_year);

CREATE TABLE syl_topics (
  id         text PRIMARY KEY,
  unit_id    text NOT NULL,
  title      text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  taught_on  date,
  taught_by  text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX syl_topic_unit_idx ON syl_topics (unit_id);
```
`0000_syllabus.down.sql`:
```sql
DROP TABLE syl_topics;
DROP TABLE syl_units;
```

- [ ] **Step 3: Drizzle schema** — `src/db/schema.ts` mirroring `coursework/src/db/schema.ts` style (import `date, index, integer, pgTable, text, timestamp, uniqueIndex`):
```ts
export const sylUnits = pgTable("syl_units", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull(),
  departmentId: text("department_id").notNull(),
  classId: text("class_id").notNull(),
  subjectId: text("subject_id").notNull(),
  teacherId: text("teacher_id").notNull(),
  academicYear: text("academic_year").notNull(),
  title: text("title").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("syl_unit_title_uq").on(t.classId, t.subjectId, t.academicYear, t.title), index("syl_unit_class_idx").on(t.classId, t.academicYear)]);
export type SylUnitRow = typeof sylUnits.$inferSelect;

export const sylTopics = pgTable("syl_topics", {
  id: text("id").primaryKey(),
  unitId: text("unit_id").notNull(),
  title: text("title").notNull(),
  position: integer("position").notNull().default(0),
  taughtOn: date("taught_on", { mode: "string" }),
  taughtBy: text("taught_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("syl_topic_unit_idx").on(t.unitId)]);
export type SylTopicRow = typeof sylTopics.$inferSelect;
```

- [ ] **Step 4: Repo** — `src/repo.ts` mirroring `coursework/src/repo.ts` (a `createSyllabusRepo(db)` returning an object; a `DuplicateTitleError` reused for the unit unique-title 23505). Methods:
```ts
export interface SyllabusRepo {
  createUnit(input: Omit<SylUnitRow, "createdAt">): Promise<SylUnitRow>;   // id generated by caller (randomUUID) like coursework
  getUnit(unitId: string): Promise<SylUnitRow | null>;
  updateUnit(unitId: string, patch: { title?: string; position?: number }): Promise<SylUnitRow | null>;
  deleteUnit(unitId: string): Promise<void>;                              // also deletes its topics
  unitsForClass(classId: string, academicYear: string): Promise<SylUnitRow[]>;
  createTopic(input: { id: string; unitId: string; title: string; position: number }): Promise<SylTopicRow>;
  getTopic(topicId: string): Promise<SylTopicRow | null>;
  updateTopic(topicId: string, patch: { title?: string; position?: number }): Promise<SylTopicRow | null>;
  deleteTopic(topicId: string): Promise<void>;
  setCoverage(topicId: string, taughtOn: string | null, taughtBy: string | null): Promise<SylTopicRow | null>;
  topicsForUnits(unitIds: string[]): Promise<SylTopicRow[]>;              // used to assemble the view + coverage
}
```
Follow coursework's create pattern (generate id via `randomUUID()` in the handler, pass in; map 23505 → `DuplicateTitleError`). `deleteUnit` deletes topics first (`where inArray(sylTopics.unitId, ...)` for that unit) then the unit, in a transaction if coursework does, else two statements.

- [ ] **Step 5: Coverage-rollup helper + its test** — a pure function used by the view assembly, in `repo.ts` (exported) or a small `src/coverage.ts`:
```ts
export function coveragePct(topics: { taughtOn: string | null }[]): number {
  if (topics.length === 0) return 0;
  const taught = topics.filter((t) => t.taughtOn !== null).length;
  return Math.round((taught / topics.length) * 100);
}
```
`src/repo.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { coveragePct } from "./coverage"; // or "./repo"
describe("coveragePct", () => {
  it("is 0 for no topics", () => expect(coveragePct([])).toBe(0));
  it("is 0 when none taught", () => expect(coveragePct([{ taughtOn: null }, { taughtOn: null }])).toBe(0));
  it("is 100 when all taught", () => expect(coveragePct([{ taughtOn: "2026-07-01" }])).toBe(100));
  it("rounds partial coverage", () => expect(coveragePct([{ taughtOn: "2026-07-01" }, { taughtOn: null }, { taughtOn: null }])).toBe(33));
});
```

- [ ] **Step 6: Run the repo test**
Run: `npx vitest run --project unit packages/modules/syllabus`
Expected: PASS (4/4 coverage cases).

- [ ] **Step 7: Commit**
```bash
git add packages/modules/syllabus/
git commit -m "feat(syllabus): package scaffold + schema + migration + repo"
```

---

### Task 2: Module definition + handlers + factory + conformance tests

**Files:**
- Create: `packages/modules/syllabus/src/definition.ts`
- Create: `packages/modules/syllabus/src/handlers.ts`
- Create: `packages/modules/syllabus/src/index.ts`
- Create: `packages/modules/syllabus/src/definition.test.ts` (conformance, copied from coursework/system)
- Create: `packages/modules/syllabus/src/handlers.test.ts`

**Interfaces:**
- Consumes: `SyllabusRepo`, `coveragePct` (Task 1); `PeopleDirectory` (from `@vidya/module-people`: `classPath`, `subjectDepartment`, `namesFor`, `teacherByIdentityUser`, `studentByIdentityUser`, `studentPosition`); `ScopeChecker`.
- Produces: `syllabusModuleDefinition`, `MODULE_NAME="syllabus"`, `createSyllabusModule(deps)`, and the route ids listed below. View shapes `UnitView`/`TopicView`/`SyllabusView`.

**Route table (all `module: "syllabus"`, `tags: ["syllabus"]`):**

| id | method | path | auth | audit action / resourceType |
|---|---|---|---|---|
| `syllabus.unit-create` | POST | `/api/v1/syllabus/units` | TEACHER_ONLY | `syllabus.unit-created` / `syllabus-unit` |
| `syllabus.unit-update` | PATCH | `/api/v1/syllabus/units/{unitId}` | TEACHER_ONLY | `syllabus.unit-updated` / `syllabus-unit` |
| `syllabus.unit-delete` | DELETE | `/api/v1/syllabus/units/{unitId}` | TEACHER_ONLY | `syllabus.unit-deleted` / `syllabus-unit` |
| `syllabus.topic-create` | POST | `/api/v1/syllabus/units/{unitId}/topics` | TEACHER_ONLY | `syllabus.topic-created` / `syllabus-topic` |
| `syllabus.topic-update` | PATCH | `/api/v1/syllabus/topics/{topicId}` | TEACHER_ONLY | `syllabus.topic-updated` / `syllabus-topic` |
| `syllabus.topic-delete` | DELETE | `/api/v1/syllabus/topics/{topicId}` | TEACHER_ONLY | `syllabus.topic-deleted` / `syllabus-topic` |
| `syllabus.topic-coverage` | PUT | `/api/v1/syllabus/topics/{topicId}/coverage` | TEACHER_ONLY | `syllabus.coverage-set` / `syllabus-topic` |
| `syllabus.class-syllabus` | GET | `/api/v1/syllabus/classes/{classId}/syllabus` | ANY_AUTHENTICATED | (read, no audit) |
| `syllabus.my` | GET | `/api/v1/syllabus/my` | STUDENT_ONLY | (read, no audit) |

- [ ] **Step 1: definition.ts** — mirror `coursework/src/definition.ts` header (MODULE_NAME/TABLE_PREFIX, `idSchema`, `academicYearSchema`, `dateSchema`, `problemSchema`, the `TEACHER_ONLY`/`STUDENT_ONLY`/`ANY_AUTHENTICATED` consts). Define view schemas:
```ts
const topicViewSchema = z.object({ id: z.string(), title: z.string(), position: z.number(), taughtOn: z.string().nullable() });
const unitViewSchema = z.object({
  id: z.string(), classId: z.string(), subjectId: z.string(), subjectName: z.string(),
  title: z.string(), position: z.number(), academicYear: z.string(),
  topics: z.array(topicViewSchema), coveragePct: z.number(),
});
const syllabusViewSchema = z.object({ units: z.array(unitViewSchema) });
const subjectSyllabusSchema = z.object({ subjectId: z.string(), subjectName: z.string(), coveragePct: z.number(), units: z.array(unitViewSchema) });
const mySyllabusSchema = z.object({ subjects: z.array(subjectSyllabusSchema) });
```
Then the 9 `RouteSpec`s per the table above. Bodies:
- unit-create: `{ classId, subjectId, academicYear, title: z.string().trim().min(1).max(160), position: z.number().int().min(0).default(0) }`
- unit-update: `{ title: z.string().trim().min(1).max(160).optional(), position: z.number().int().min(0).optional() }` `.refine(≥1 field)`
- topic-create: params `{ unitId }`, body `{ title: z.string().trim().min(1).max(200), position: z.number().int().min(0).default(0) }`
- topic-update: same refine shape as unit-update
- topic-coverage: params `{ topicId }`, body `{ taughtOn: dateSchema.nullable() }`
- class-syllabus: params `{ classId }`, query `{ academicYear: academicYearSchema }`, 200 → `syllabusViewSchema`
- my: 200 → `mySyllabusSchema`
Give each the `403/404/409/422` responses coursework uses where applicable (unit-create: 409 duplicate title, 422 subject-not-of-department, 404 no class/subject, 403 not this subject's teacher).
Export `syllabusModuleDefinition: ModuleDefinition` with `name: MODULE_NAME`, `routes`, `jobs: []`, `tablePrefix: TABLE_PREFIX`, `migrationsDir: "migrations"` (match coursework's ModuleDefinition fields exactly — read coursework's export).

- [ ] **Step 2: definition.test.ts** — copy `packages/modules/coursework/src/definition.test.ts` verbatim, swap `courseworkModuleDefinition`→`syllabusModuleDefinition` and any name literals. Keep every conformance assertion (versioned paths, unique ids, justified public routes, audited mutations). This is your RED-then-GREEN guard for route wiring.

- [ ] **Step 3: handlers.ts** — mirror `coursework/src/handlers.ts`. Reuse verbatim: `notFound`, `denied`, the `Target`/`resolveTarget(classId, subjectId)` block, `teacherAllowed(principal, path, subjectId)` (change `resourceType` to `"syllabus-unit"`), and the student resolution (`linkedStudent`, `studentClass`). Deps interface:
```ts
export interface SyllabusHandlerDeps {
  readonly repo: SyllabusRepo;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
}
```
Handlers:
- **unitCreate**: `resolveTarget` → `teacherAllowed` (403) → resolve teacher via `directory.teacherByIdentityUser(principal.id)` → `repo.createUnit({ id: randomUUID(), collegeId, departmentId, classId, subjectId, teacherId, academicYear, title, position })`; map `DuplicateTitleError`→409; return 201 unitView (empty topics, coveragePct 0). Audit `{ resourceId, details: { classId, subjectId, title } }`.
- **unitUpdate / unitDelete**: `repo.getUnit` (404) → build org path via `directory.classPath(unit.classId)` → `teacherAllowed(principal, path, unit.subjectId)` (403) → `repo.updateUnit`/`repo.deleteUnit`. Audit accordingly.
- **topicCreate**: `repo.getUnit(params.unitId)` (404) → path from `directory.classPath` → `teacherAllowed(…, unit.subjectId)` (403) → `repo.createTopic({ id: randomUUID(), unitId, title, position })`; 201 topicView.
- **topicUpdate / topicDelete**: `repo.getTopic` (404) → `repo.getUnit(topic.unitId)` for subjectId+path → `teacherAllowed` (403) → update/delete.
- **topicCoverage** (PUT): `repo.getTopic` (404) → unit for subjectId/path → `teacherAllowed` (403) → `repo.setCoverage(topicId, body.taughtOn, body.taughtOn === null ? null : principal.id)`; 200 topicView. Audit `{ resourceId, details: { taughtOn: body.taughtOn } }`.
- **classSyllabus** (GET): `directory.classPath(classId)` (404) → `repo.unitsForClass(classId, academicYear)` → `repo.topicsForUnits(unitIds)` → assemble unitViews (topics grouped by unitId, sorted by position); **row-filter**: keep a unit only if `scopeChecker.check(principal, "read", { module:"syllabus", resourceType:"syllabus-unit", org: path, subjectId: unit.subjectId }).granted` (mirror `coursework.class-assignments` filtering) → resolve subject names via `directory.namesFor(subjectIds)` → `coveragePct(topics)` per unit → `{ units }`.
- **my** (GET): `studentClass(principal)` (null→404 or empty) → `repo.unitsForClass(class, currentYear?)`. Year: mirror how coursework.my resolves the student's year (read coursework.my-materials; if it takes year from a fixed "current" helper or the enrollment, follow that). Group units by subject → per-subject `coveragePct` over all its topics; return `{ subjects }`. No scope filter (student sees their own class's subjects).

Register all 9 in the returned `Record<string, RouteHandler>` keyed by route id.

- [ ] **Step 4: index.ts** — mirror `coursework/src/index.ts`: export `MODULE_NAME as SYLLABUS_MODULE_NAME, syllabusModuleDefinition`; `SyllabusModuleDeps { db, audit, scopeChecker, peopleDirectory }` (NO storage); `createSyllabusModule(deps)` builds repo, returns `{ definition, handlers: createSyllabusHandlers({ repo, directory: deps.peopleDirectory, scopeChecker: deps.scopeChecker }), jobProcessors: {}, readinessChecks: [], service: {} }`; call `assertModuleWiring(module)`.

- [ ] **Step 5: handlers.test.ts** — TDD. Build a fake `SyllabusRepo` (in-memory Maps) + a fake `PeopleDirectory` + a fake `ScopeChecker` (grant when `subjectId==="S1"`, deny otherwise) mirroring coursework's `handlers.test.ts` harness. Tests (write first, watch fail, implement):
  - subject teacher (grant S1) creates a unit + topic → 201; a teacher of S2 → 403 on unit-create.
  - `topic-coverage` sets `taughtOn` + `taughtBy=principal.id`; clearing (`taughtOn:null`) nulls both.
  - `class-syllabus` row-filters: a teacher granted only S1 sees S1 units, not S2 units; coveragePct computed (0 / partial / 100).
  - `my` for a linked student returns their class's subjects with coverage; unlinked → 404/empty.

- [ ] **Step 6: Run the module tests**
Run: `npx vitest run --project unit packages/modules/syllabus`
Expected: PASS (definition conformance + all handler cases). Provide RED→GREEN evidence for the handler tests.

- [ ] **Step 7: Commit**
```bash
git add packages/modules/syllabus/src/
git commit -m "feat(syllabus): module definition + handlers + factory + conformance"
```

---

### Task 3: Register the module + migrate + OpenAPI

**Files:**
- Modify: `scripts/registry.ts` (import + `moduleDefinitions` array)
- Modify: `apps/web/src/composition.ts` (factory + `modules` array)
- Modify: `apps/worker/src/main.ts` (factory + `modules` array — mirror coursework, which is wired here despite having no jobs)
- Modify: `apps/web/package.json`, `apps/worker/package.json` (workspace dep)
- Create: `apps/web/app/api/v1/syllabus/units/route.ts`, `.../units/[unitId]/route.ts`, `.../units/[unitId]/topics/route.ts`, `.../topics/[topicId]/route.ts`, `.../topics/[topicId]/coverage/route.ts`, `.../classes/[classId]/syllabus/route.ts`, `.../my/route.ts`
- Modify: regenerated OpenAPI artifact(s)

**Interfaces:**
- Consumes: `syllabusModuleDefinition`, `createSyllabusModule` (Task 2).

- [ ] **Step 1: Workspace deps** — add `"@vidya/module-syllabus": "workspace:*"` to the `dependencies` of `apps/web/package.json` and `apps/worker/package.json` (next to `@vidya/module-coursework`). Run `pnpm install` to link.

- [ ] **Step 2: registry.ts** — add `import { syllabusModuleDefinition } from "@vidya/module-syllabus";` and add `syllabusModuleDefinition` to the `moduleDefinitions` array.

- [ ] **Step 3: composition.ts (web)** — mirror the coursework block: import `createSyllabusModule`, instantiate near coursework:
```ts
const syllabus = createSyllabusModule({
  db,
  audit: system.service.audit,
  scopeChecker: identityCore.scopeChecker,
  peopleDirectory: people.service.directory,
});
```
and add `syllabus` to the `modules: RuntimeModule<unknown>[]` array.

- [ ] **Step 4: worker main.ts** — same import + factory + add to its `modules` array (mirror how coursework appears there).

- [ ] **Step 5: Route files** — create the 7 thin route files (import `routeHandler` only). Examples:
`apps/web/app/api/v1/syllabus/units/route.ts`:
```ts
import { routeHandler } from "@/composition";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = routeHandler("syllabus.unit-create");
```
`.../units/[unitId]/route.ts` → `PATCH` = `syllabus.unit-update`, `DELETE` = `syllabus.unit-delete`.
`.../units/[unitId]/topics/route.ts` → `POST` = `syllabus.topic-create`.
`.../topics/[topicId]/route.ts` → `PATCH` = `syllabus.topic-update`, `DELETE` = `syllabus.topic-delete`.
`.../topics/[topicId]/coverage/route.ts` → `PUT` = `syllabus.topic-coverage`.
`.../classes/[classId]/syllabus/route.ts` → `GET` = `syllabus.class-syllabus`.
`.../my/route.ts` → `GET` = `syllabus.my`.

- [ ] **Step 6: Ownership + typecheck + migrate round-trip + OpenAPI**
Run (bash, env exported):
```
pnpm check:ownership
pnpm --filter @vidya/web exec tsc --noEmit
npx tsx scripts/migrate.ts up
npx tsx scripts/migrate.ts down --steps 1
npx tsx scripts/migrate.ts up
pnpm openapi:generate
```
Expected: ownership passes (syl_ prefix); typecheck clean; migration applies + rolls back + re-applies; OpenAPI lists the 9 `/api/v1/syllabus/*` routes. Commit the regenerated OpenAPI with this task.

- [ ] **Step 7: Commit**
```bash
git add scripts/registry.ts apps/web/src/composition.ts apps/worker/src/main.ts \
  apps/web/package.json apps/worker/package.json pnpm-lock.yaml \
  apps/web/app/api/v1/syllabus/ <regenerated openapi files>
git commit -m "feat(syllabus): register module + web routes + migrate + openapi"
```

---

### Task 4: Web API client

**Files:**
- Modify: `apps/web/src/ui/api.ts`

**Interfaces:**
- Produces: types `TopicView`, `UnitView`, `SyllabusView`, `SubjectSyllabus`, `MySyllabus`; `api.syllabusForClass`, `createUnit`, `updateUnit`, `deleteUnit`, `addTopic`, `updateTopic`, `deleteTopic`, `setTopicCoverage`, `mySyllabus`.

- [ ] **Step 1: Types** (match the view schemas from Task 2):
```ts
export interface TopicView { id: string; title: string; position: number; taughtOn: string | null }
export interface UnitView { id: string; classId: string; subjectId: string; subjectName: string; title: string; position: number; academicYear: string; topics: TopicView[]; coveragePct: number }
export interface SyllabusView { units: UnitView[] }
export interface SubjectSyllabus { subjectId: string; subjectName: string; coveragePct: number; units: UnitView[] }
export interface MySyllabus { subjects: SubjectSyllabus[] }
```

- [ ] **Step 2: Client functions** (use this file's existing `get`/`post`/`patch`/`put`/`del` helpers — confirm the exact helper names as they appear in the file, as done in the teacher-profile client):
```ts
  syllabusForClass: (classId: string, academicYear: string) =>
    get<SyllabusView>(`/api/v1/syllabus/classes/${encodeURIComponent(classId)}/syllabus?academicYear=${encodeURIComponent(academicYear)}`),
  createUnit: (body: { classId: string; subjectId: string; academicYear: string; title: string; position?: number }) =>
    post<UnitView>("/api/v1/syllabus/units", body),
  updateUnit: (unitId: string, body: { title?: string; position?: number }) =>
    patch<UnitView>(`/api/v1/syllabus/units/${encodeURIComponent(unitId)}`, body),
  deleteUnit: (unitId: string) => del<{ ok: true }>(`/api/v1/syllabus/units/${encodeURIComponent(unitId)}`),
  addTopic: (unitId: string, body: { title: string; position?: number }) =>
    post<TopicView>(`/api/v1/syllabus/units/${encodeURIComponent(unitId)}/topics`, body),
  updateTopic: (topicId: string, body: { title?: string; position?: number }) =>
    patch<TopicView>(`/api/v1/syllabus/topics/${encodeURIComponent(topicId)}`, body),
  deleteTopic: (topicId: string) => del<{ ok: true }>(`/api/v1/syllabus/topics/${encodeURIComponent(topicId)}`),
  setTopicCoverage: (topicId: string, taughtOn: string | null) =>
    put<TopicView>(`/api/v1/syllabus/topics/${encodeURIComponent(topicId)}/coverage`, { taughtOn }),
  mySyllabus: () => get<MySyllabus>("/api/v1/syllabus/my"),
```

- [ ] **Step 3: Typecheck + commit**
Run: `pnpm --filter @vidya/web exec tsc --noEmit` → PASS.
```bash
git add apps/web/src/ui/api.ts
git commit -m "feat(web): syllabus api client"
```

---

### Task 5: `/manage/syllabus` page + nav

**Files:**
- Create: `apps/web/app/(app)/manage/syllabus/page.tsx`
- Modify: `apps/web/src/ui/navConfig.ts`
- Test: `apps/web/src/ui/syllabus-page.test.tsx`

**Interfaces:**
- Consumes: the Task 4 client + `api.colleges`/`api.collegeTree`/`currentAcademicYear` (as `/manage/teachers` uses) for the class/subject pickers.

- [ ] **Step 1: Nav entry** in `navConfig.ts` (reuse an existing icon):
```ts
{ href: "/manage/syllabus", label: "Syllabus", icon: "file", group: "Teaching", roles: ["teacher", "class_teacher", "hod", "principal", "admin"] },
```

- [ ] **Step 2: Page** (`"use client"`, `export const dynamic = "force-dynamic"`). Class picker + subject picker (from the org tree, as `/manage/teachers/page.tsx` builds `classOptions`). On class+year, call `api.syllabusForClass`. Render units (each a `Card` with a coverage ring/bar from `coveragePct`) and their topics; for a subject the caller can write (the create/patch calls will 403 otherwise — surface as a toast), show: add-unit, rename/delete unit, add/rename/delete topic, and a per-topic **Taught** control — a native `<input type="date">` defaulting to today that calls `api.setTopicCoverage(topicId, value || null)`; clearing un-marks. Five states: loading `Skeleton`; empty "No syllabus yet — add the first unit." (or read-only "No syllabus published for this subject."); error EmptyState; 403/withheld surfaced honestly; saving disables controls. Both themes via tokens; no hand-rolled colors.

- [ ] **Step 3: UI test** (`syllabus-page.test.tsx`, mirror an existing page test; mock the api client): asserts the empty state renders; a loaded syllabus renders units+topics+coverage; marking a topic taught calls `setTopicCoverage` with the date. Run: `npx vitest run --project ui apps/web/src/ui/syllabus-page.test.tsx` → PASS.

- [ ] **Step 4: Typecheck + build + commit**
Run: `pnpm --filter @vidya/web exec tsc --noEmit` and `pnpm --filter @vidya/web build` → PASS. Report visuals NOT verified (owner reviews).
```bash
git add apps/web/app/(app)/manage/syllabus/page.tsx apps/web/src/ui/navConfig.ts apps/web/src/ui/syllabus-page.test.tsx
git commit -m "feat(web): syllabus manage page + nav"
```

---

### Task 6: Portal "Course coverage" card

**Files:**
- Modify: `apps/web/app/(app)/portal/page.tsx`
- Test: extend the portal page test if one exists, else add a focused test

**Interfaces:**
- Consumes: `api.mySyllabus()`, `MySyllabus`.

- [ ] **Step 1: Card** — add a "Course coverage" card to `/portal` following the page's existing per-card `catch(() => null)` resilience idiom (so a failure hides the card, not the page). Fetch `api.mySyllabus()`; for each subject render a coverage bar (`coveragePct`) and expandable units→topics (taught topic shows `taughtOn`; untaught shows a muted dot). Read-only. Both themes via tokens; if `subjects` is empty, render nothing (or a quiet "No syllabus published yet."). Follow the portal's existing card layout components.

- [ ] **Step 2: Test** — assert the card renders coverage from a mocked `mySyllabus` (one subject, partial coverage) and that a null/failed fetch omits the card. Run the portal test file under `--project ui` → PASS.

- [ ] **Step 3: Typecheck + build + commit**
Run: `pnpm --filter @vidya/web exec tsc --noEmit` + `pnpm --filter @vidya/web build` → PASS. Visuals NOT verified.
```bash
git add apps/web/app/(app)/portal/page.tsx <portal test>
git commit -m "feat(web): portal course-coverage card"
```

---

### Task 7: Seed + integration + full sweep

**Files:**
- Modify: `scripts/seed-demo.ts`
- Create: `tests/integration/syllabus-flow.int.test.ts`

**Interfaces:**
- Consumes: the live scope-checked routes; the demo seed's existing teacher/subject/class setup.

- [ ] **Step 1: Seed** — after the seed creates class/subject/teacher assignments, seed a small syllabus for one or two subjects: 2 units, 3–4 topics each, a couple marked `taughtOn` (a past date). Insert via the repo directly OR through the module's create routes if the seed drives HTTP; follow the seed script's existing style for other modules (e.g. how coursework/notices seed, if they do). Keep names India-realistic.

- [ ] **Step 2: Integration test** — `tests/integration/syllabus-flow.int.test.ts` mirroring an existing module integration test: a subject teacher (real login + scope) creates a unit+topics and marks one taught; `GET /classes/{classId}/syllabus` returns it with the right coveragePct; a DIFFERENT subject's teacher is 403 on write and row-filtered out on read; a student of the class reads `GET /syllabus/my` and sees the subject + coverage. Do NOT weaken auth to pass — use the legitimate login/link flow. Run:
```
INTEGRATION_RESET_DB=true npx vitest run --project integration --no-file-parallelism syllabus
```
Expected: PASS.

- [ ] **Step 3: Reseed + full sweep + build**
Run (bash, env exported):
```
# drop public schema, then:
npx tsx scripts/migrate.ts up
VIDYA_ALLOW_DEMO_SEED=true npx tsx scripts/seed-demo.ts
npx vitest run --project unit --project ui
pnpm --filter @vidya/web build
pnpm check:ownership
```
Expected: reseed clean (incl. 0000_syllabus); unit+ui all green (≥ prior baseline + new tests); build clean; ownership passes.

- [ ] **Step 4: Commit**
```bash
git add scripts/seed-demo.ts tests/integration/syllabus-flow.int.test.ts
git commit -m "feat(syllabus): seed a demo syllabus + integration coverage"
```

---

## Self-review notes
- **Spec coverage:** data model (T1), routes incl. coverage + row-filtered read + student `my` (T2), no-ScopeChecker-change via `teacherAllowed` (T2, explicit constraint), registration in 3 places + migrate + openapi (T3), api client (T4), `/manage/syllabus` + five states + nav (T5), portal card (T6), seed + integration + sweep (T7). Deferred items (HOD authoring, hours/outcomes, PDF, analytics) explicitly out of scope.
- **Auth:** no task edits `scope-checker.ts` or the grant matrix; writes route through `teacherAllowed`, student read through the enrollment link.
- **Type consistency:** `coveragePct` (number, rounded) used identically in repo helper, view schemas, client types; `taughtOn` (`string | null`, ISO date) consistent across schema → repo → view → client. Route ids in T2's table match T3's route files and T4's client paths.
- **Open detail for the implementer to resolve from coursework:** the exact `ModuleDefinition` field set and the `my`-route academic-year resolution — both are read directly from the coursework module (named in the tasks), not invented here.
