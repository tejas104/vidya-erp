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
