# M7 Staff Leave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the staff-leave register — teachers apply for leave; their HOD or the principal approves/rejects with a reason — as a new `@vidya/module-leave`, wired into web/worker and driven live.

**Architecture:** A new module `lvs_` mirroring the just-shipped `@vidya/module-exams` shape (definition + drizzle schema + repo + handlers + index + unit tests + migration). Approval routing uses a request's `department_id`, resolved at apply time from the teacher's teaching assignments via a new `PeopleDirectory.teacherDepartments()` read. Authorization reuses the existing `Principal.grants[].org` overlap model — no new scope primitive.

**Tech Stack:** TypeScript, drizzle-orm (Postgres), zod, Next.js (App Router) for the web UI, vitest + React Testing Library for tests, pnpm workspaces.

## Global Constraints

- **Table prefix:** every table in this module starts `lvs_`. (House rule — one prefix per module, e.g. `exm_`, `ntc_`.)
- **No cross-module FKs** (Constitution rule 2): `teacher_id`, `college_id`, `department_id`, `decided_by` are opaque `text`, no `REFERENCES` to other modules' tables.
- **Approvers:** HOD (department-scoped grant) or principal/admin (college-scoped grant). Reused via `Principal.grants[].org`.
- **Reject requires a note; approve does not.**
- **`department_id` is nullable** — null = college-level request (unassigned teacher), principal-only.
- **Kinds:** exactly `casual` | `sick` | `duty`. **Statuses:** `pending` | `approved` | `rejected`.
- **Academic year format** where used: `YYYY-YY` (e.g. `2026-27`) — but leave rows store no academic year; dates are `YYYY-MM-DD`.
- **Out of scope (do not build):** leave balances/quotas, half-day/hourly leave, overlap detection, withdrawal/cancellation, notifications, teacher home-department column.
- Spec: `docs/superpowers/specs/2026-07-14-m7-staff-leave-design.md`.

---

## File Structure

**New package `packages/modules/leave/`:**
- `package.json` — deps `@vidya/module-people`, `@vidya/platform`, `drizzle-orm`, `zod`.
- `tsconfig.json` — copy of `packages/modules/exams/tsconfig.json`.
- `src/db/schema.ts` — the `lvsRequests` drizzle table + row type.
- `src/definition.ts` — `MODULE_NAME`, `TABLE_PREFIX`, zod schemas, route specs, `leaveModuleDefinition`.
- `src/repo.ts` — `LeaveRepo` interface + `createLeaveRepo(db)`.
- `src/handlers.ts` — `createLeaveHandlers(deps)` (apply / my-requests / pending-for-me / decide).
- `src/handlers.test.ts` — unit tests with in-memory fakes (denials + happy paths).
- `src/index.ts` — public API: `createLeaveModule`, `LEAVE_MODULE_NAME`, `leaveModuleDefinition`.
- `migrations/0000_leave.sql` + `migrations/0000_leave.down.sql`.

**Modified — people module (the new directory read):**
- `packages/modules/people/src/index.ts` — add `teacherDepartments` to the `PeopleDirectory` interface + its real implementation.
- `packages/modules/people/src/repo/people-repo.ts` — add `departmentsForTeacher(teacherId)` query (join assignments → classes for distinct departments).

**Modified — PeopleDirectory fakes (must implement the new method or typecheck breaks):**
- `packages/modules/academics/test-support/fakes.ts`
- `packages/modules/analytics/test-support/fakes.ts`

**Modified — web (frontend):**
- `apps/web/src/ui/api.ts` — `LeaveRequestView` type + `lvsApply` / `lvsMine` / `lvsPending` / `lvsDecide` client methods.
- `apps/web/app/(app)/manage/leave/page.tsx` — role-adaptive page (new).
- `apps/web/src/ui/leave-page.test.tsx` — RTL tests (new).
- `apps/web/app/(app)/dashboard/page.tsx` — "N leave requests waiting" card.

**Modified — integration:**
- `apps/web/src/composition.ts` — construct + register `createLeaveModule`.
- `apps/worker/src/main.ts` — construct + add to the module array (no jobs).
- `scripts/registry.ts` — add `leaveModuleDefinition` (migrations).
- `scripts/seed-demo.ts` — `seedLeaveBlock`: one pending + one decided request.
- `package.json` (root) — add `@vidya/module-leave` workspace dep (seed imports it).

---

## Task 1: Leave module (contract + backend)

Builds the whole `@vidya/module-leave` package with full handler logic and unit tests, plus the `teacherDepartments` directory read it depends on. Ends green on typecheck + unit tests. (This merges the spec's L1 "contract" and L3 "backend": M7 has no separate cross-module backend piece — unlike M6's hall-ticket PDF — so splitting by layer would break TDD and produce a hollow gate.)

**Files:**
- Create: `packages/modules/leave/package.json`, `tsconfig.json`, `src/db/schema.ts`, `src/definition.ts`, `src/repo.ts`, `src/handlers.ts`, `src/handlers.test.ts`, `src/index.ts`, `migrations/0000_leave.sql`, `migrations/0000_leave.down.sql`
- Modify: `packages/modules/people/src/index.ts`, `packages/modules/people/src/repo/people-repo.ts`, `packages/modules/academics/test-support/fakes.ts`, `packages/modules/analytics/test-support/fakes.ts`

**Interfaces:**
- Consumes (from people): `PeopleDirectory.teacherByIdentityUser(id): Promise<{teacherId,collegeId,fullName}|null>`, `PeopleDirectory.namesFor(ids): Promise<Map<string,string>>`, `PeopleDirectory.collegeExists(id): Promise<boolean>`; new `PeopleDirectory.teacherDepartments(teacherId): Promise<string[]>`.
- Consumes (from platform): `Db`, `AuditLogger`, `RuntimeModule`, `assertModuleWiring`, `Principal`, `OrgPath`, `RouteHandler`, `ModuleDefinition`, `RouteSpec`.
- Produces (for later tasks): `createLeaveModule(deps: { db, audit, peopleDirectory }): RuntimeModule<Record<string, never>>`; `leaveModuleDefinition`; `LEAVE_MODULE_NAME = "leave"`. Route ids: `leave.apply`, `leave.my-requests`, `leave.pending-for-me`, `leave.decide`.

---

- [ ] **Step 1: Scaffold the package manifest and tsconfig**

Create `packages/modules/leave/package.json`:

```json
{
  "name": "@vidya/module-leave",
  "version": "0.1.0",
  "private": true,
  "description": "Vidya leave module (lvs_): the staff-leave register. Teachers apply for leave (casual/sick/duty); their HOD or the principal approves or rejects with a reason.",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vidya/module-people": "workspace:*",
    "@vidya/platform": "workspace:*",
    "drizzle-orm": "^0.44.2",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "pino": "^9.7.0",
    "typescript": "^5.8.3",
    "vitest": "^3.2.0"
  }
}
```

Create `packages/modules/leave/tsconfig.json` by copying `packages/modules/exams/tsconfig.json` verbatim (read that file and reproduce it — it extends the repo base config and needs no edits).

- [ ] **Step 2: Install so the workspace links the new package**

Run: `pnpm install`
Expected: completes without error; `@vidya/module-leave` resolves.

- [ ] **Step 3: Write the drizzle schema**

Create `packages/modules/leave/src/db/schema.ts`:

```ts
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** lvs_: the staff-leave register. A request is raised by a teacher and decided
 * by their HOD (department_id) or the principal (college-wide). department_id is
 * null for teachers with no assignments — those go straight to the principal. */
export const lvsRequests = pgTable(
  "lvs_requests",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id"), // nullable = college-level
    teacherId: text("teacher_id").notNull(),
    fromOn: text("from_on").notNull(),
    toOn: text("to_on").notNull(),
    kind: text("kind").notNull(), // casual | sick | duty
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lvs_requests_teacher_idx").on(table.teacherId),
    index("lvs_requests_college_status_idx").on(table.collegeId, table.status),
    index("lvs_requests_dept_status_idx").on(table.departmentId, table.status),
  ],
);
export type LeaveRequestRow = typeof lvsRequests.$inferSelect;
```

- [ ] **Step 4: Write the migration SQL**

Create `packages/modules/leave/migrations/0000_leave.sql`:

```sql
-- Vidya M7 (leave): the staff-leave register.
CREATE TABLE lvs_requests (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text,                       -- null = college-level (principal-decided)
  teacher_id text NOT NULL,
  from_on text NOT NULL,
  to_on text NOT NULL,
  kind text NOT NULL,                       -- casual | sick | duty
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lvs_requests_window_check CHECK (to_on >= from_on)
);
CREATE INDEX lvs_requests_teacher_idx ON lvs_requests (teacher_id);
CREATE INDEX lvs_requests_college_status_idx ON lvs_requests (college_id, status);
CREATE INDEX lvs_requests_dept_status_idx ON lvs_requests (department_id, status);
```

Create `packages/modules/leave/migrations/0000_leave.down.sql`:

```sql
DROP TABLE IF EXISTS lvs_requests;
```

- [ ] **Step 5: Write the definition (schemas + route specs)**

Create `packages/modules/leave/src/definition.ts`:

```ts
import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "leave";
export const TABLE_PREFIX = "lvs_";

const idSchema = z.string().min(1).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date like "2026-11-02"');
const kindSchema = z.enum(["casual", "sick", "duty"]);

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

export const leaveRequestViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  departmentId: z.string().nullable(),
  teacherId: z.string(),
  teacherName: z.string(),
  fromOn: z.string(),
  toOn: z.string(),
  kind: kindSchema,
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
});

const routes: RouteSpec[] = [
  {
    id: "leave.apply",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/leave/requests",
    summary: "Apply for leave (staff self) — routes to the HOD or principal",
    tags: ["leave"],
    auth: ANY_AUTHENTICATED,
    request: {
      body: z.object({
        fromOn: dateSchema,
        toOn: dateSchema,
        kind: kindSchema,
        reason: z.string().trim().min(1).max(500),
        departmentId: idSchema.optional(),
      }),
    },
    audit: { action: "leave.applied", resourceType: "leave-request" },
    responses: {
      201: { description: "Applied", schema: leaveRequestViewSchema },
      404: { description: "This sign-in is not linked to a staff record", schema: problemSchema },
      422: { description: "Invalid range or a departmentId not belonging to the teacher", schema: problemSchema },
    },
  },
  {
    id: "leave.my-requests",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/leave/mine",
    summary: "The signed-in staff member's own leave requests, newest first",
    tags: ["leave"],
    auth: ANY_AUTHENTICATED,
    responses: {
      200: { description: "Own requests", schema: z.object({ requests: z.array(leaveRequestViewSchema) }) },
      404: { description: "Not linked to a staff record", schema: problemSchema },
    },
  },
  {
    id: "leave.pending-for-me",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/leave/pending",
    summary: "Pending requests the caller can decide (HOD: their dept · principal: college)",
    tags: ["leave"],
    auth: ANY_AUTHENTICATED,
    responses: {
      200: { description: "Pending requests, newest first", schema: z.object({ requests: z.array(leaveRequestViewSchema) }) },
    },
  },
  {
    id: "leave.decide",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/leave/requests/{requestId}/decide",
    summary: "Approve or reject a pending request (HOD/principal) — reject needs a note",
    tags: ["leave"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ requestId: idSchema }),
      body: z.object({
        status: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(500).optional(),
      }),
    },
    audit: { action: "leave.decided", resourceType: "leave-request" },
    responses: {
      200: { description: "Decided", schema: leaveRequestViewSchema },
      403: { description: "Not the applicant's approver, or deciding own request", schema: problemSchema },
      404: { description: "No such request", schema: problemSchema },
      409: { description: "Already decided", schema: problemSchema },
      422: { description: "Reject without a note", schema: problemSchema },
    },
  },
];

export const leaveModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
};
```

- [ ] **Step 6: Write the repo**

Create `packages/modules/leave/src/repo.ts`:

```ts
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { lvsRequests, type LeaveRequestRow } from "./db/schema";

export interface LeaveRepo {
  create(input: {
    collegeId: string;
    departmentId: string | null;
    teacherId: string;
    fromOn: string;
    toOn: string;
    kind: string;
    reason: string;
  }): Promise<LeaveRequestRow>;
  get(id: string): Promise<LeaveRequestRow | null>;
  listForTeacher(teacherId: string): Promise<LeaveRequestRow[]>;
  /** Pending requests in a college whose department is one of `departmentIds`,
   * OR (when `includeCollegeWide`) whose department is null. Newest first. */
  listPending(
    collegeId: string,
    departmentIds: string[],
    includeCollegeWide: boolean,
  ): Promise<LeaveRequestRow[]>;
  decide(input: {
    id: string;
    status: "approved" | "rejected";
    decidedBy: string;
    decisionNote: string | null;
  }): Promise<LeaveRequestRow>;
}

export function createLeaveRepo(db: Db): LeaveRepo {
  return {
    async create(input) {
      const rows = await db
        .insert(lvsRequests)
        .values({ id: `lvr_${randomUUID()}`, ...input })
        .returning();
      return rows[0]!;
    },

    async get(id) {
      const rows = await db.select().from(lvsRequests).where(eq(lvsRequests.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listForTeacher(teacherId) {
      return db
        .select()
        .from(lvsRequests)
        .where(eq(lvsRequests.teacherId, teacherId))
        .orderBy(desc(lvsRequests.createdAt));
    },

    async listPending(collegeId, departmentIds, includeCollegeWide) {
      // Principal: every pending row in the college (no dept filter — this also
      // covers null-department rows). HOD: only their departments' pending rows.
      if (!includeCollegeWide && departmentIds.length === 0) return [];
      const base = [eq(lvsRequests.collegeId, collegeId), eq(lvsRequests.status, "pending")];
      const where = includeCollegeWide
        ? and(...base)
        : and(...base, inArray(lvsRequests.departmentId, departmentIds));
      return db.select().from(lvsRequests).where(where).orderBy(desc(lvsRequests.createdAt));
    },

    async decide(input) {
      const rows = await db
        .update(lvsRequests)
        .set({
          status: input.status,
          decidedBy: input.decidedBy,
          decisionNote: input.decisionNote,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(lvsRequests.id, input.id))
        .returning();
      return rows[0]!;
    },
  };
}
```

Note: the principal case (`includeCollegeWide`) returns all pending rows in the college regardless of department — that already covers the null-department rows, so no separate `collegeWide` predicate is needed. The `deptMatch` branch is used only for a pure-HOD caller. `collegeWide`/`scope` locals above are written so the query reads explicitly; keep the logic: **principal → college-only filter; HOD → college + dept-in-list.**

- [ ] **Step 7: Add `teacherDepartments` to the people repo**

In `packages/modules/people/src/repo/people-repo.ts`, add to the `PeopleRepo` interface (near `assignmentsByTeacher` at line ~99):

```ts
  /** Distinct department ids across a teacher's assignments (via their classes). */
  departmentsForTeacher(teacherId: string): Promise<string[]>;
```

And add the implementation next to `assignmentsByTeacher` (line ~375). It joins assignments → classes because assignments carry `class_id`, not `department_id`:

```ts
    async departmentsForTeacher(teacherId) {
      const rows = await db
        .selectDistinct({ departmentId: pplClasses.departmentId })
        .from(pplTeacherAssignments)
        .innerJoin(pplClasses, eq(pplTeacherAssignments.classId, pplClasses.id))
        .where(eq(pplTeacherAssignments.teacherId, teacherId));
      return rows.map((row) => row.departmentId);
    },
```

Ensure `pplClasses` is imported in this file (it may already be — check the import from `../db/schema`; add `pplClasses` if missing).

- [ ] **Step 8: Add `teacherDepartments` to the PeopleDirectory interface + real impl**

In `packages/modules/people/src/index.ts`, add to the `PeopleDirectory` interface (near `teacherByIdentityUser`, line ~86):

```ts
  /** Leave routing: the departments a teacher belongs to (via assignments). */
  teacherDepartments(teacherId: string): Promise<string[]>;
```

And in the object that implements the directory (near `teacherByIdentityUser`'s impl, line ~207), add:

```ts
        teacherDepartments: (teacherId) => peopleRepo.departmentsForTeacher(teacherId),
```

- [ ] **Step 9: Satisfy the two PeopleDirectory fakes**

Adding an interface method breaks every `implements PeopleDirectory`. Update both fakes.

In `packages/modules/academics/test-support/fakes.ts`, inside `class FakePeopleDirectory` (next to `studentsExist`), add:

```ts
  async teacherDepartments(): Promise<string[]> {
    return [ORG.departmentId];
  }
```

In `packages/modules/analytics/test-support/fakes.ts`, inside `class FakeDirectory` (next to `studentsExist`), add:

```ts
  async teacherDepartments(): Promise<string[]> {
    return [ORG.departmentId];
  }
```

- [ ] **Step 10: Write the failing handler tests**

Create `packages/modules/leave/src/handlers.test.ts`. This defines an in-memory fake directory + repo and covers apply (auto dept, explicit dept, unassigned→null, bad range 422), my-requests, pending-for-me (HOD dept scope, principal college scope), and decide denials (own-request 403, HOD-outside-dept 403, already-decided 409, reject-without-note 422).

```ts
import { describe, expect, it } from "vitest";
import type { Principal } from "@vidya/platform";
import { createLeaveHandlers } from "./handlers";
import type { LeaveRepo } from "./repo";
import type { LeaveRequestRow } from "./db/schema";

const COLLEGE = "col_1";
const DEPT_A = "dep_a";
const DEPT_B = "dep_b";
const TEACHER = "tch_1";
const TEACHER_MULTI = "tch_2";

// --- fakes ---------------------------------------------------------------
function fakeDirectory() {
  return {
    collegeExists: async (id: string) => id === COLLEGE,
    namesFor: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, `Name ${id}`])),
    teacherByIdentityUser: async (identityUserId: string) =>
      identityUserId === "u_teacher"
        ? { teacherId: TEACHER, collegeId: COLLEGE, fullName: "Meera" }
        : identityUserId === "u_teacher_multi"
          ? { teacherId: TEACHER_MULTI, collegeId: COLLEGE, fullName: "Ravi" }
          : null,
    teacherDepartments: async (teacherId: string) =>
      teacherId === TEACHER ? [DEPT_A] : teacherId === TEACHER_MULTI ? [DEPT_A, DEPT_B] : [],
  } as const;
}

function fakeRepo(seed: LeaveRequestRow[] = []): LeaveRepo & { rows: LeaveRequestRow[] } {
  const rows = [...seed];
  return {
    rows,
    async create(input) {
      const row: LeaveRequestRow = {
        id: `lvr_${rows.length + 1}`,
        collegeId: input.collegeId,
        departmentId: input.departmentId,
        teacherId: input.teacherId,
        fromOn: input.fromOn,
        toOn: input.toOn,
        kind: input.kind,
        reason: input.reason,
        status: "pending",
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    async get(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listForTeacher(teacherId) {
      return rows.filter((r) => r.teacherId === teacherId);
    },
    async listPending(collegeId, departmentIds, includeCollegeWide) {
      return rows.filter(
        (r) =>
          r.collegeId === collegeId &&
          r.status === "pending" &&
          (includeCollegeWide || (r.departmentId !== null && departmentIds.includes(r.departmentId))),
      );
    },
    async decide(input) {
      const row = rows.find((r) => r.id === input.id)!;
      row.status = input.status;
      row.decidedBy = input.decidedBy;
      row.decisionNote = input.decisionNote;
      row.decidedAt = new Date();
      return row;
    },
  };
}

const recordingAudit = { record: async () => {} };

function principal(over: Partial<Principal>): Principal {
  return {
    id: "u_x",
    roles: [],
    scopes: [],
    grants: [],
    ...over,
  } as Principal;
}

function ctx(principalArg: Principal, request: { body?: unknown; params?: unknown; query?: unknown }) {
  return { principal: principalArg, request } as never;
}

function makeHandlers(repo: LeaveRepo) {
  return createLeaveHandlers({ repo, directory: fakeDirectory() as never, audit: recordingAudit as never });
}

// --- tests ---------------------------------------------------------------
describe("leave.apply", () => {
  it("auto-fills the department when the teacher has exactly one", async () => {
    const repo = fakeRepo();
    const res = await makeHandlers(repo)["leave.apply"]!(
      ctx(principal({ id: "u_teacher", roles: ["teacher"] }), {
        body: { fromOn: "2026-08-01", toOn: "2026-08-02", kind: "casual", reason: "trip" },
      }),
    );
    expect(res.status).toBe(201);
    expect((res.body as { departmentId: string | null }).departmentId).toBe(DEPT_A);
  });

  it("requires a valid departmentId when the teacher spans several", async () => {
    const repo = fakeRepo();
    const bad = await makeHandlers(repo)["leave.apply"]!(
      ctx(principal({ id: "u_teacher_multi", roles: ["teacher"] }), {
        body: { fromOn: "2026-08-01", toOn: "2026-08-02", kind: "sick", reason: "flu" },
      }),
    );
    expect(bad.status).toBe(422);
    const ok = await makeHandlers(repo)["leave.apply"]!(
      ctx(principal({ id: "u_teacher_multi", roles: ["teacher"] }), {
        body: { fromOn: "2026-08-01", toOn: "2026-08-02", kind: "sick", reason: "flu", departmentId: DEPT_B },
      }),
    );
    expect(ok.status).toBe(201);
    expect((ok.body as { departmentId: string | null }).departmentId).toBe(DEPT_B);
  });

  it("stores a null department for an unassigned teacher", async () => {
    const repo = fakeRepo();
    // teacherByIdentityUser returns a teacher, but teacherDepartments is empty.
    const directory = { ...fakeDirectory(), teacherDepartments: async () => [] };
    const handlers = createLeaveHandlers({ repo, directory: directory as never, audit: recordingAudit as never });
    const res = await handlers["leave.apply"]!(
      ctx(principal({ id: "u_teacher", roles: ["teacher"] }), {
        body: { fromOn: "2026-08-01", toOn: "2026-08-02", kind: "duty", reason: "conf" },
      }),
    );
    expect(res.status).toBe(201);
    expect((res.body as { departmentId: string | null }).departmentId).toBeNull();
  });

  it("404s when the sign-in is not a staff record", async () => {
    const res = await makeHandlers(fakeRepo())["leave.apply"]!(
      ctx(principal({ id: "u_nobody", roles: ["teacher"] }), {
        body: { fromOn: "2026-08-01", toOn: "2026-08-02", kind: "casual", reason: "x" },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("leave.decide", () => {
  function pendingRow(over: Partial<LeaveRequestRow> = {}): LeaveRequestRow {
    return {
      id: "lvr_1",
      collegeId: COLLEGE,
      departmentId: DEPT_A,
      teacherId: TEACHER,
      fromOn: "2026-08-01",
      toOn: "2026-08-02",
      kind: "casual",
      reason: "trip",
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
  }

  it("lets the HOD of the request's department approve", async () => {
    const repo = fakeRepo([pendingRow()]);
    const res = await makeHandlers(repo)["leave.decide"]!(
      ctx(principal({ id: "u_hod", roles: ["hod"], grants: [{ org: { collegeId: COLLEGE, departmentId: DEPT_A } } as never] }), {
        params: { requestId: "lvr_1" },
        body: { status: "approved" },
      }),
    );
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("approved");
  });

  it("403s an HOD deciding a request outside their department", async () => {
    const repo = fakeRepo([pendingRow({ departmentId: DEPT_B })]);
    const res = await makeHandlers(repo)["leave.decide"]!(
      ctx(principal({ id: "u_hod", roles: ["hod"], grants: [{ org: { collegeId: COLLEGE, departmentId: DEPT_A } } as never] }), {
        params: { requestId: "lvr_1" },
        body: { status: "approved" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("403s the applicant deciding their own request", async () => {
    const repo = fakeRepo([pendingRow()]);
    // A teacher who is also somehow granted the dept — self-decision must still fail.
    const res = await makeHandlers(repo)["leave.decide"]!(
      ctx(principal({ id: "u_teacher", roles: ["teacher", "hod"], grants: [{ org: { collegeId: COLLEGE, departmentId: DEPT_A } } as never] }), {
        params: { requestId: "lvr_1" },
        body: { status: "approved" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("409s deciding an already-decided request", async () => {
    const repo = fakeRepo([pendingRow({ status: "approved" })]);
    const res = await makeHandlers(repo)["leave.decide"]!(
      ctx(principal({ id: "u_principal", roles: ["principal"], grants: [{ org: { collegeId: COLLEGE } } as never] }), {
        params: { requestId: "lvr_1" },
        body: { status: "rejected", note: "late" },
      }),
    );
    expect(res.status).toBe(409);
  });

  it("422s a reject with no note", async () => {
    const repo = fakeRepo([pendingRow()]);
    const res = await makeHandlers(repo)["leave.decide"]!(
      ctx(principal({ id: "u_principal", roles: ["principal"], grants: [{ org: { collegeId: COLLEGE } } as never] }), {
        params: { requestId: "lvr_1" },
        body: { status: "rejected" },
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe("leave.pending-for-me", () => {
  it("shows an HOD only their department's pending rows", async () => {
    const repo = fakeRepo([
      { id: "a", collegeId: COLLEGE, departmentId: DEPT_A, teacherId: TEACHER, fromOn: "2026-08-01", toOn: "2026-08-01", kind: "casual", reason: "x", status: "pending", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: new Date(), updatedAt: new Date() },
      { id: "b", collegeId: COLLEGE, departmentId: DEPT_B, teacherId: "tch_9", fromOn: "2026-08-01", toOn: "2026-08-01", kind: "casual", reason: "y", status: "pending", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const res = await makeHandlers(repo)["leave.pending-for-me"]!(
      ctx(principal({ id: "u_hod", roles: ["hod"], grants: [{ org: { collegeId: COLLEGE, departmentId: DEPT_A } } as never] }), {}),
    );
    expect(res.status).toBe(200);
    const ids = (res.body as { requests: { id: string }[] }).requests.map((r) => r.id);
    expect(ids).toEqual(["a"]);
  });

  it("shows a principal every pending row in the college", async () => {
    const repo = fakeRepo([
      { id: "a", collegeId: COLLEGE, departmentId: DEPT_A, teacherId: TEACHER, fromOn: "2026-08-01", toOn: "2026-08-01", kind: "casual", reason: "x", status: "pending", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: new Date(), updatedAt: new Date() },
      { id: "b", collegeId: COLLEGE, departmentId: null, teacherId: "tch_9", fromOn: "2026-08-01", toOn: "2026-08-01", kind: "casual", reason: "y", status: "pending", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const res = await makeHandlers(repo)["leave.pending-for-me"]!(
      ctx(principal({ id: "u_principal", roles: ["principal"], grants: [{ org: { collegeId: COLLEGE } } as never] }), {}),
    );
    const ids = (res.body as { requests: { id: string }[] }).requests.map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 11: Run the tests to verify they fail**

Run: `pnpm --filter @vidya/module-leave exec vitest run`
Expected: FAIL — `createLeaveHandlers` is not defined (handlers.ts not written yet).

- [ ] **Step 12: Write the handlers**

Create `packages/modules/leave/src/handlers.ts`:

```ts
import type { AuditLogger, Principal, RouteHandler } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { LeaveRepo } from "./repo";
import type { LeaveRequestRow } from "./db/schema";

export interface LeaveHandlerDeps {
  readonly repo: LeaveRepo;
  readonly directory: PeopleDirectory;
  readonly audit: AuditLogger;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied(message = "access denied") {
  return { status: 403, body: { message } };
}

/** Can this caller decide a request in `departmentId`/`collegeId`?
 * A principal/college grant (no departmentId) covers the whole college; an HOD
 * grant covers a matching department. Null-department requests need a college grant. */
function covers(principal: Principal, collegeId: string, departmentId: string | null): boolean {
  return principal.grants.some((grant) => {
    if (grant.org.collegeId !== collegeId) return false;
    if (grant.org.departmentId === undefined) return true; // college-wide (principal/admin)
    return departmentId !== null && grant.org.departmentId === departmentId;
  });
}

export function createLeaveHandlers(deps: LeaveHandlerDeps): Record<string, RouteHandler> {
  async function view(row: LeaveRequestRow, name?: string) {
    const teacherName = name ?? (await deps.directory.namesFor([row.teacherId])).get(row.teacherId) ?? row.teacherId;
    return {
      id: row.id,
      collegeId: row.collegeId,
      departmentId: row.departmentId,
      teacherId: row.teacherId,
      teacherName,
      fromOn: row.fromOn,
      toOn: row.toOn,
      kind: row.kind,
      reason: row.reason,
      status: row.status,
      decisionNote: row.decisionNote,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    };
  }

  async function viewAll(rows: LeaveRequestRow[]) {
    const names = await deps.directory.namesFor(rows.map((r) => r.teacherId));
    return Promise.all(rows.map((r) => view(r, names.get(r.teacherId) ?? r.teacherId)));
  }

  const apply: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      fromOn: string; toOn: string; kind: string; reason: string; departmentId?: string;
    };
    const teacher = await deps.directory.teacherByIdentityUser(principal.id);
    if (teacher === null) return notFound("this sign-in is not linked to a staff record");
    if (body.toOn < body.fromOn) {
      return { status: 422, body: { message: "the leave would end before it starts" } };
    }
    const departments = await deps.directory.teacherDepartments(teacher.teacherId);
    let departmentId: string | null;
    if (departments.length === 0) {
      departmentId = null; // college-level: the principal decides
    } else if (departments.length === 1) {
      departmentId = departments[0]!;
    } else {
      if (body.departmentId === undefined || !departments.includes(body.departmentId)) {
        return { status: 422, body: { message: "choose one of your departments" } };
      }
      departmentId = body.departmentId;
    }
    const row = await deps.repo.create({
      collegeId: teacher.collegeId,
      departmentId,
      teacherId: teacher.teacherId,
      fromOn: body.fromOn,
      toOn: body.toOn,
      kind: body.kind,
      reason: body.reason,
    });
    return {
      status: 201,
      body: await view(row, teacher.fullName),
      audit: { resourceId: row.id, details: { kind: row.kind, fromOn: row.fromOn, toOn: row.toOn } },
    };
  };

  const myRequests: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const teacher = await deps.directory.teacherByIdentityUser(principal.id);
    if (teacher === null) return notFound("this sign-in is not linked to a staff record");
    const rows = await deps.repo.listForTeacher(teacher.teacherId);
    return { status: 200, body: { requests: await viewAll(rows) } };
  };

  const pendingForMe: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    // The caller's college(s) and the departments they hold an HOD grant on.
    const collegeId = principal.grants[0]?.org.collegeId;
    if (collegeId === undefined) return { status: 200, body: { requests: [] } };
    const isCollegeWide = principal.grants.some(
      (grant) => grant.org.collegeId === collegeId && grant.org.departmentId === undefined,
    );
    const departmentIds = principal.grants
      .filter((grant) => grant.org.collegeId === collegeId && grant.org.departmentId !== undefined)
      .map((grant) => grant.org.departmentId!);
    const rows = await deps.repo.listPending(collegeId, departmentIds, isCollegeWide);
    return { status: 200, body: { requests: await viewAll(rows) } };
  };

  const decide: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { requestId: string };
    const body = ctx.request.body as { status: "approved" | "rejected"; note?: string };
    const row = await deps.repo.get(params.requestId);
    if (row === null) return notFound("no such request");
    if (row.teacherId && (await deps.directory.teacherByIdentityUser(principal.id))?.teacherId === row.teacherId) {
      return denied("you cannot decide your own leave");
    }
    if (!covers(principal, row.collegeId, row.departmentId)) return denied();
    if (row.status !== "pending") return { status: 409, body: { message: "already decided" } };
    const note = body.note?.trim() ?? "";
    if (body.status === "rejected" && note === "") {
      return { status: 422, body: { message: "a rejection needs a note" } };
    }
    const updated = await deps.repo.decide({
      id: row.id,
      status: body.status,
      decidedBy: principal.id,
      decisionNote: note === "" ? null : note,
    });
    return {
      status: 200,
      body: await view(updated),
      audit: { resourceId: row.id, details: { status: body.status } },
    };
  };

  return {
    "leave.apply": apply,
    "leave.my-requests": myRequests,
    "leave.pending-for-me": pendingForMe,
    "leave.decide": decide,
  };
}
```

- [ ] **Step 13: Write the module public API**

Create `packages/modules/leave/src/index.ts`:

```ts
/**
 * @vidya/module-leave — PUBLIC API (the only importable surface).
 *
 * The staff-leave register: teachers apply for leave; their HOD (by the
 * request's department) or the principal (college-wide) approves or rejects
 * with a reason. No jobs — approvals only.
 */

import {
  assertModuleWiring,
  type AuditLogger,
  type Db,
  type RuntimeModule,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { leaveModuleDefinition } from "./definition";
import { createLeaveHandlers } from "./handlers";
import { createLeaveRepo } from "./repo";

export { MODULE_NAME as LEAVE_MODULE_NAME, leaveModuleDefinition } from "./definition";

export interface LeaveModuleDeps {
  readonly db: Db;
  readonly audit: AuditLogger;
  readonly peopleDirectory: PeopleDirectory;
}

export function createLeaveModule(deps: LeaveModuleDeps): RuntimeModule<Record<string, never>> {
  const repo = createLeaveRepo(deps.db);
  const module: RuntimeModule<Record<string, never>> = {
    definition: leaveModuleDefinition,
    handlers: createLeaveHandlers({ repo, directory: deps.peopleDirectory, audit: deps.audit }),
    jobProcessors: {},
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
```

- [ ] **Step 14: Run the module tests to verify they pass**

Run: `pnpm --filter @vidya/module-leave exec vitest run`
Expected: PASS — all apply/decide/pending tests green.

- [ ] **Step 15: Typecheck the touched packages**

Run: `pnpm --filter @vidya/module-leave --filter @vidya/module-people --filter @vidya/module-academics --filter @vidya/module-analytics typecheck`
Expected: all `Done`, no errors. (Confirms the `teacherDepartments` interface addition and both fake updates line up.)

- [ ] **Step 16: Commit**

```bash
git add packages/modules/leave packages/modules/people package.json pnpm-lock.yaml \
  packages/modules/academics/test-support/fakes.ts packages/modules/analytics/test-support/fakes.ts
git commit -m "feat(leave): M7 module — apply/decide/pending, dept-routed approvals (L1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Frontend — /manage/leave + api client + dashboard card

Role-adaptive page: teachers apply and track; HOD/principal additionally get an approvals queue. Plus the dashboard "N waiting" card. Follows the structure of the existing `apps/web/app/(app)/manage/exams/page.tsx` and its test `apps/web/src/ui/exams-page.test.tsx` — read both before writing.

**Files:**
- Modify: `apps/web/src/ui/api.ts` (view type + client methods)
- Create: `apps/web/app/(app)/manage/leave/page.tsx`
- Create: `apps/web/src/ui/leave-page.test.tsx`
- Modify: `apps/web/app/(app)/dashboard/page.tsx` (waiting card)

**Interfaces:**
- Consumes: the four routes from Task 1 — `POST /api/v1/leave/requests`, `GET /api/v1/leave/mine`, `GET /api/v1/leave/pending`, `POST /api/v1/leave/requests/{id}/decide`. Response bodies match `leaveRequestViewSchema`.
- Produces: `api.lvsApply`, `api.lvsMine`, `api.lvsPending`, `api.lvsDecide`, and the `LeaveRequestView` type for the dashboard card.

---

- [ ] **Step 1: Add the view type + client methods to the api**

In `apps/web/src/ui/api.ts`, add the type near the other view interfaces (e.g. after the `// --- exams ---` block around line 443):

```ts
// --- leave ---
export interface LeaveRequestView {
  id: string;
  collegeId: string;
  departmentId: string | null;
  teacherId: string;
  teacherName: string;
  fromOn: string;
  toOn: string;
  kind: "casual" | "sick" | "duty";
  reason: string;
  status: "pending" | "approved" | "rejected";
  decisionNote: string | null;
  decidedAt: string | null;
}
```

And add the client methods inside the `api` object (near the exams client block around line 756):

```ts
  // --- leave ---
  lvsApply: (body: { fromOn: string; toOn: string; kind: "casual" | "sick" | "duty"; reason: string; departmentId?: string }) =>
    post<LeaveRequestView>("/api/v1/leave/requests", body),
  lvsMine: () => get<{ requests: LeaveRequestView[] }>("/api/v1/leave/mine"),
  lvsPending: () => get<{ requests: LeaveRequestView[] }>("/api/v1/leave/pending"),
  lvsDecide: (requestId: string, body: { status: "approved" | "rejected"; note?: string }) =>
    post<LeaveRequestView>(`/api/v1/leave/requests/${encodeURIComponent(requestId)}/decide`, body),
```

- [ ] **Step 2: Write the failing RTL test**

Create `apps/web/src/ui/leave-page.test.tsx`. Mirror the setup of `exams-page.test.tsx` (mock `@/ui/api`, render the page, use `@testing-library/react`). Cover: a teacher sees the apply button + their requests with status badges; an HOD sees the approvals queue with Approve/Reject; Reject is blocked until a note is entered.

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import LeavePage from "@/../app/(app)/manage/leave/page";

const pending = {
  id: "lvr_1", collegeId: "col_1", departmentId: "dep_a", teacherId: "tch_9",
  teacherName: "Ravi Kumar", fromOn: "2026-08-01", toOn: "2026-08-02", kind: "casual",
  reason: "family trip", status: "pending", decisionNote: null, decidedAt: null,
} as const;

vi.mock("@/ui/api", async () => {
  const actual = await vi.importActual<typeof import("@/ui/api")>("@/ui/api");
  return {
    ...actual,
    api: {
      whoami: vi.fn(),
      lvsMine: vi.fn(async () => ({ requests: [] })),
      lvsPending: vi.fn(async () => ({ requests: [pending] })),
      lvsApply: vi.fn(),
      lvsDecide: vi.fn(async () => ({ ...pending, status: "approved" })),
    },
  };
});

import { api } from "@/ui/api";

describe("LeavePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the approvals queue with a pending request for an approver", async () => {
    (api.whoami as ReturnType<typeof vi.fn>).mockResolvedValue({ roles: ["hod"], grants: [{ org: { collegeId: "col_1", departmentId: "dep_a" } }] });
    render(<LeavePage />);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
  });

  it("blocks reject until a note is typed", async () => {
    (api.whoami as ReturnType<typeof vi.fn>).mockResolvedValue({ roles: ["hod"], grants: [{ org: { collegeId: "col_1", departmentId: "dep_a" } }] });
    render(<LeavePage />);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    const confirm = await screen.findByRole("button", { name: /confirm reject/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "too short notice" } });
    expect(confirm).toBeEnabled();
  });
});
```

Note: adjust the `whoami` shape and role-detection to match how the codebase already exposes the current principal to pages (check `exams-page.test.tsx` and the real `api.whoami`/session hook; reuse that mechanism rather than inventing one). If pages read roles from a context/hook instead of `api.whoami`, mock that instead.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @vidya/web exec vitest run src/ui/leave-page.test.tsx`
Expected: FAIL — the page module doesn't exist yet.

- [ ] **Step 4: Write the page**

Create `apps/web/app/(app)/manage/leave/page.tsx`. Structure (mirror `exams/page.tsx` for imports, `PageHeader`, `Card`, `Badge`, `Modal`, `DataTable`, `EmptyState`, `Skeleton`, `useToast`, `"use client"`, `export const dynamic = "force-dynamic"`):

- On mount: read the current principal's roles/grants (same mechanism the other manage pages use). Compute `isApprover = roles includes hod|principal|admin` (or has any grant). Fetch `api.lvsMine()` always; fetch `api.lvsPending()` when `isApprover`.
- **Approvals section** (only when `isApprover` and there are pending rows): a `DataTable` — columns teacher, dates (`fromOn → toOn`), kind, reason, and an actions cell with **Approve** and **Reject** buttons. Approve → `api.lvsDecide(id, { status: "approved" })`. Reject → open a small `Modal`/`ConfirmDialog` with a required note textarea (`aria-label="note"`); the confirm button (`name="Confirm reject"`) stays `disabled` until the note is non-empty; on confirm → `api.lvsDecide(id, { status: "rejected", note })`. After either, refetch pending + mine, toast success.
- **Apply** button → `Modal` with native `<input type="date">` from/to, a kind `<select>` (casual/sick/duty), a reason `<textarea>`, and a department `<select>` shown **only** when the teacher has >1 department. On submit → `api.lvsApply(...)`, refetch mine, toast. (Resolving "how many departments the teacher has" for the select: call `api.lvsApply` optimistically and, on a 422 "choose one of your departments", reveal the dept select. Simpler and avoids a new endpoint — the server is the source of truth. Populate the select from the teacher's grants exposed on the principal, filtered to departments.)
- **My requests** section: a `DataTable` of `api.lvsMine()` — dates, kind, status `Badge` (pending → warn, approved → good, rejected → accent). For rejected/approved rows, show `decisionNote` on row expand (reuse the expand pattern from an existing table, or a secondary muted line).

Keep copy plain: empty approvals → nothing rendered; empty my-requests → `EmptyState` "You haven't applied for any leave."

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @vidya/web exec vitest run src/ui/leave-page.test.tsx`
Expected: PASS.

- [ ] **Step 6: Add the dashboard "N waiting" card**

In `apps/web/app/(app)/dashboard/page.tsx`, for an approver (hod/principal/admin), fetch `api.lvsPending()` and, when `requests.length > 0`, render a card "{n} leave request{s} waiting" linking to `/manage/leave`. Hide it when zero. Follow the existing card/tile pattern already in that file (match how other dashboard cards fetch + render; do not introduce a new card component).

- [ ] **Step 7: Typecheck + full web unit tests**

Run: `pnpm --filter @vidya/web typecheck && pnpm --filter @vidya/web exec vitest run`
Expected: typecheck `Done`; all UI tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/ui/api.ts "apps/web/app/(app)/manage/leave/page.tsx" \
  apps/web/src/ui/leave-page.test.tsx "apps/web/app/(app)/dashboard/page.tsx"
git commit -m "feat(web): leave frontend — apply + approvals queue + dashboard card (L2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Integration — wire, seed, drive, merge

Wires the module into both composition roots and the migration registry, seeds a pending + a decided request, and drives teacher-apply → HOD-approve against the live stack.

**Files:**
- Modify: `apps/web/src/composition.ts`, `apps/worker/src/main.ts`, `scripts/registry.ts`, `scripts/seed-demo.ts`

**Interfaces:**
- Consumes: `createLeaveModule` + `leaveModuleDefinition` from Task 1.
- Produces: the running module (routes served, migrations registered) and demo data.

---

- [ ] **Step 1: Register the module in the migration registry**

In `scripts/registry.ts`: add the import after the results import —

```ts
import { leaveModuleDefinition } from "@vidya/module-leave";
```

and add `leaveModuleDefinition,` to the `moduleDefinitions` array (after `examsModuleDefinition,`).

- [ ] **Step 2: Add the workspace dep so scripts + registry resolve it**

In the root `package.json` dependencies, add after `@vidya/module-exams`:

```json
    "@vidya/module-leave": "workspace:*",
```

Run: `pnpm install`
Expected: links `@vidya/module-leave` into the root.

- [ ] **Step 3: Wire the web composition root**

In `apps/web/src/composition.ts`: add `import { createLeaveModule } from "@vidya/module-leave";` next to the exams import; construct it after `exams` (it only needs db/audit/peopleDirectory) —

```ts
  // --- leave --- (no reporting source; approvals only)
  const leave = createLeaveModule({
    db,
    audit: system.service.audit,
    peopleDirectory: people.service.directory,
  });
```

and add `leave` to the `modules` array (after `exams`).

- [ ] **Step 4: Wire the worker composition root**

In `apps/worker/src/main.ts`: add the same import; construct `leave` the same way after `exams`; add `leave` to the `modules` array (after `exams`). No queue/jobs (like notices).

- [ ] **Step 5: Typecheck web + worker**

Run: `pnpm --filter @vidya/web --filter @vidya/worker typecheck`
Expected: both `Done`.

- [ ] **Step 6: Add the seed block**

In `scripts/seed-demo.ts`: add `import { createLeaveModule } from "@vidya/module-leave";` next to the exams import; construct `leave` and add it to the module-registration loop array (the `for (const module of [...])` that registers route handlers), like exams was added.

Then add `seedLeaveBlock` next to `seedExamsBlock`. It applies as a demo teacher (needs that teacher's cookie) and decides as the HOD. Model the mechanics on how the seed already signs in non-admin roles (reuse the existing `provisionUser` + login helpers; the demo already provisions `demo-teacher-ds` and `demo-hod-cse`). Concretely:

```ts
/** Leave demo data (L4) — idempotent: skips when the teacher already has
 * requests. Applies one casual leave as a CSE teacher, leaves it pending, and
 * applies + approves a second (sick) as the same teacher decided by the HOD, so
 * the HOD queue shows one waiting and the teacher sees one approved. */
async function seedLeaveBlock(teacherCookie: string, hodCookie: string): Promise<void> {
  const mine = await expectJson<{ requests: { id: string }[] }>(
    await call("leave.my-requests", { cookie: teacherCookie }),
    [200],
    "leave mine",
  );
  if (mine.requests.length > 0) {
    console.log("  leave: requests already present — skipping");
    return;
  }
  // One left pending for the HOD queue.
  await expectJson(
    await call("leave.apply", {
      cookie: teacherCookie,
      body: { fromOn: "2026-08-10", toOn: "2026-08-11", kind: "casual", reason: "Family function" },
    }),
    [201],
    "leave apply (pending)",
  );
  // One applied then approved by the HOD.
  const toApprove = await expectJson<{ id: string }>(
    await call("leave.apply", {
      cookie: teacherCookie,
      body: { fromOn: "2026-07-20", toOn: "2026-07-20", kind: "sick", reason: "Fever" },
    }),
    [201],
    "leave apply (to approve)",
  );
  const decided = await call("leave.decide", {
    cookie: hodCookie,
    params: { requestId: toApprove.id },
    body: { status: "approved" },
  });
  if (decided.status !== 200) {
    throw new Error(`leave decide: ${decided.status} — ${await decided.text()}`);
  }
  console.log("  leave: 1 pending + 1 approved for a CSE teacher");
}
```

Wire the call where the demo signs in the CSE teacher and HOD (both cookies are already produced in the seed — reuse them). If a teacher/HOD cookie isn't already in scope at a convenient point, sign them in with the existing login helper the seed uses for other roles. Call `seedLeaveBlock(teacherCookie, hodCookie)` on the main tree-seeding path (near the other 6x blocks) and, if practical, on the incremental path too.

- [ ] **Step 7: Run migrations and the seed against the live stack**

Ensure Docker infra is up (`docker compose ps` shows postgres/redis healthy). Then:

```bash
set -a; . ./.env; set +a
pnpm db:migrate
VIDYA_ALLOW_DEMO_SEED=true pnpm seed:demo 2>&1 | grep -i "leave\|error"
```

Expected: migration applies `leave/0000_leave`; seed prints `leave: 1 pending + 1 approved for a CSE teacher`.

- [ ] **Step 8: Verify the rows landed and the scope reads correctly**

```bash
docker exec atlas-postgres-1 psql -U vidya -d vidya -c \
  "SELECT status, kind, department_id IS NOT NULL AS has_dept FROM lvs_requests ORDER BY status;"
```

Expected: two rows — one `pending casual`, one `approved sick`, both `has_dept = t`.

- [ ] **Step 9: Full gate — typecheck + unit tests**

Run: `pnpm -w typecheck && pnpm test`
Expected: typecheck `Done` across the workspace; all unit tests pass.

- [ ] **Step 10: Tick the plan + merge-train doc**

In `docs/superpowers/plans/2026-07-13-erp-master-plan-v2.md`: check the L1–L4 boxes for M7, and update the merge-train line to `M7 Leave ✅ (2026-07-14, live-verified)`.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/composition.ts apps/worker/src/main.ts scripts/registry.ts \
  scripts/seed-demo.ts package.json pnpm-lock.yaml \
  docs/superpowers/plans/2026-07-13-erp-master-plan-v2.md
git commit -m "feat(leave): wire M7 into web/worker/registry + seed + live-verified (L4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `lvs_requests` schema (all columns, nullable dept, CHECK) → Task 1 Steps 3–4. ✓
- Routes apply / my-requests / pending-for-me / decide → Task 1 Steps 5, 12. ✓
- Approach A department resolution (auto/pick/null) → Task 1 Step 12 `apply` + tests Step 10. ✓
- `teacherDepartments` directory read (interface + impl + fakes) → Task 1 Steps 7–9. ✓
- Scope rule via `Principal.grants[].org`; denials (own-request 403, HOD-outside-dept 403, already-decided 409, reject-no-note 422) → Task 1 Step 12 + tests Step 10. ✓
- Role-adaptive `/manage/leave` + apply modal + approvals queue + status badges → Task 2 Step 4. ✓
- Dashboard "N waiting" card → Task 2 Step 6. ✓
- Wiring web/worker/registry + seed pending+decided + live drive → Task 3. ✓
- Out-of-scope items are not built. ✓

**Placeholder scan:** No "TBD"/"add validation"/"similar to". The two spots that reference existing files as templates (exams page, dashboard cards) point at real files the implementer reads, with the M7-specific behavior spelled out — not placeholders.

**Type consistency:** `LeaveRequestRow` columns match across schema/repo/handlers/tests; `createLeaveHandlers({ repo, directory, audit })` signature identical in index.ts, tests, and handlers; route ids identical in definition, handlers map, and seed calls; `teacherDepartments` signature identical in the people interface, impl, and both fakes; `LeaveRequestView` (web) matches `leaveRequestViewSchema` (module) field-for-field.

**One known soft spot to confirm during Task 2:** how a page reads the current principal's roles/grants (context/hook vs `api.whoami`). The plan says to reuse whatever `exams-page.test.tsx` / the manage pages already use rather than invent a mechanism — resolve it by reading those files first.
