import { describe, expect, it } from "vitest";
import type { Principal, RedisClient, ScopeGrant } from "@vidya/platform";
import { createIdentityCore } from "@vidya/module-identity";
import { QueryService } from "./query-service";
import { createAnalyticsReadModel } from "./read-model";
import {
  FakeAcademicsRead,
  FakeDirectory,
  InMemoryRollupsRepo,
  ORG,
  paths,
} from "../../test-support/fakes";

const core = createIdentityCore({ redis: {} as RedisClient, session: { ttlHours: 1, idleMinutes: 1 } });
const YEAR = "2026-27";

function caller(id: string, roles: Principal["roles"], grants: ScopeGrant[]): Principal {
  return { id, kind: "user", displayName: id, roles, scopes: [], grants, sessionId: "s" };
}
const classTeacher = caller("ct", ["class_teacher"], [{ role: "class_teacher", org: paths.class }]);
const mathTeacher = caller("tm", ["teacher"], [{ role: "teacher", org: paths.class, subjectId: ORG.mathId }]);

async function makeReadModel() {
  const repo = new InMemoryRollupsRepo();
  const read = new FakeAcademicsRead();
  const directory = new FakeDirectory();
  directory.positions.set("stu_1", paths.sectionA);
  directory.roster = [{ studentId: "stu_1", academicYear: YEAR }];
  read.attendance = [
    {
      entryId: "e1",
      studentId: "stu_1",
      status: "present",
      heldOn: "2026-07-01",
      academicYear: YEAR,
      position: { ...paths.class, sectionId: ORG.sectionA },
    },
  ];
  read.marks = [
    {
      markId: "m1",
      studentId: "stu_1",
      scorePct: 72,
      kind: "exam",
      assessmentName: "Midterm",
      heldOn: "2026-07-01",
      recordedAt: "2026-07-01T10:00:00Z",
      academicYear: YEAR,
      position: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId, subjectId: ORG.mathId },
    },
  ];
  await repo.replaceYear(YEAR, {
    attendance: [
      { scopeLevel: "class", nodeId: ORG.classId, ...paths.class, academicYear: YEAR, period: "YTD", sessions: 10, present: 80, absent: 20, late: 0, excused: 0, distinctStudents: 10 },
    ],
    marks: [
      { scopeLevel: "class", nodeId: ORG.classId, collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId, academicYear: YEAR, period: "YTD", subjectId: ORG.mathId, subjects: [ORG.mathId], avgPct: 70, nMarks: 10, distinctStudents: 10 },
    ],
    flags: [
      { studentId: "stu_1", academicYear: YEAR, ...paths.sectionA, attendancePct: 60, overallPct: 30, subjectPcts: { [ORG.mathId]: 30, [ORG.physicsId]: 25 }, reasons: ["low-attendance", "low-marks"] },
    ],
  });
  const query = new QueryService({ repo, academicsRead: read, directory, scopeChecker: core.scopeChecker, minCohort: 5 });
  return createAnalyticsReadModel(query, directory);
}

describe("createAnalyticsReadModel", () => {
  it("studentPerformance resolves names and passes through denied/not-found", async () => {
    const rm = await makeReadModel();
    const ok = await rm.studentPerformance(classTeacher, "stu_1", YEAR);
    expect(ok.state).toBe("ok");
    if (ok.state === "ok") {
      expect(ok.name).not.toBe("stu_1"); // resolved
      expect(ok.subjects[0]?.name).toBe("Mathematics");
    }
    expect((await rm.studentPerformance(classTeacher, "stu_ghost", YEAR)).state).toBe("not-found");
  });

  it("nodeRollups resolves node + subject names; null for unknown node", async () => {
    const rm = await makeReadModel();
    const node = await rm.nodeRollups(classTeacher, "class", ORG.classId, YEAR);
    expect(node).not.toBeNull();
    expect(node!.nodeName).toBe("BSc Year 1");
    expect(node!.marks.bySubject[0]?.name).toBe("Mathematics");
    expect(await rm.nodeRollups(classTeacher, "class", "cls_ghost", YEAR)).toBeNull();
  });

  it("atRisk passes through the field-gated entries; null for unknown node", async () => {
    const rm = await makeReadModel();
    const entries = await rm.atRisk(classTeacher, "class", ORG.classId, YEAR);
    expect(entries?.[0]?.studentId).toBe("stu_1");
    // math teacher: overall hidden (field-gated)
    const teacherView = await rm.atRisk(mathTeacher, "class", ORG.classId, YEAR);
    expect(teacherView?.[0]?.overallPct).toBeNull();
    expect(await rm.atRisk(classTeacher, "class", "cls_ghost", YEAR)).toBeNull();
  });

  it("rosterAttendance lists only students whose attendance the caller can read", async () => {
    const rm = await makeReadModel();
    const roster = await rm.rosterAttendance(classTeacher, ORG.sectionA, YEAR);
    expect(roster?.sectionName).toBe("A");
    expect(roster?.rows.map((row) => row.studentId)).toEqual(["stu_1"]);
    expect(await rm.rosterAttendance(classTeacher, "sec_ghost", YEAR)).toBeNull();
  });
});
