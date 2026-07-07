import { describe, expect, it } from "vitest";
import type { Principal, RedisClient, ScopeGrant } from "@vidya/platform";
import { createIdentityCore } from "@vidya/module-identity";
import { QueryService } from "./query-service";
import {
  FakeAcademicsRead,
  FakeDirectory,
  InMemoryRollupsRepo,
  ORG,
  paths,
} from "../../test-support/fakes";

/**
 * The serving layer tested against the REAL checker: closure, cohort,
 * field-gating and the permission-mirror dashboard.
 */

const core = createIdentityCore({
  redis: {} as RedisClient,
  session: { ttlHours: 1, idleMinutes: 1 },
});

function caller(id: string, roles: Principal["roles"], grants: ScopeGrant[]): Principal {
  return { id, kind: "user", displayName: id, roles, scopes: [], grants, sessionId: "s" };
}

const mathTeacher = caller("t-math", ["teacher"], [
  { role: "teacher", org: paths.class, subjectId: ORG.mathId },
]);
const classTeacher = caller("ct-1", ["class_teacher"], [
  { role: "class_teacher", org: paths.class },
]);
const hod = caller("h-1", ["hod"], [{ role: "hod", org: paths.department }]);
const principal = caller("p-1", ["principal"], [{ role: "principal", org: paths.college }]);

const YEAR = "2026-27";

async function makeService(options: { cohortOverride?: number } = {}) {
  const repo = new InMemoryRollupsRepo();
  const read = new FakeAcademicsRead();
  const directory = new FakeDirectory();
  const service = new QueryService({
    repo,
    academicsRead: read,
    directory,
    scopeChecker: core.scopeChecker,
    minCohort: options.cohortOverride ?? 5,
  });
  await repo.replaceYear(YEAR, {
    attendance: [
      {
        scopeLevel: "class",
        nodeId: ORG.classId,
        ...paths.class,
        academicYear: YEAR,
        period: "YTD",
        sessions: 20,
        present: 150,
        absent: 30,
        late: 10,
        excused: 10,
        distinctStudents: 10,
      },
      {
        scopeLevel: "class",
        nodeId: ORG.classId,
        ...paths.class,
        academicYear: YEAR,
        period: "2026-07",
        sessions: 10,
        present: 80,
        absent: 20,
        late: 0,
        excused: 0,
        distinctStudents: 10,
      },
    ],
    marks: [
      {
        scopeLevel: "class",
        nodeId: ORG.classId,
        collegeId: ORG.collegeId,
        departmentId: ORG.departmentId,
        classId: ORG.classId,
        academicYear: YEAR,
        period: "YTD",
        subjectId: ORG.mathId,
        subjects: [ORG.mathId],
        avgPct: 68,
        nMarks: 20,
        distinctStudents: 10,
      },
      {
        scopeLevel: "class",
        nodeId: ORG.classId,
        collegeId: ORG.collegeId,
        departmentId: ORG.departmentId,
        classId: ORG.classId,
        academicYear: YEAR,
        period: "YTD",
        subjectId: ORG.physicsId,
        subjects: [ORG.physicsId],
        avgPct: 55,
        nMarks: 18,
        distinctStudents: 9,
      },
      {
        scopeLevel: "class",
        nodeId: ORG.classId,
        collegeId: ORG.collegeId,
        departmentId: ORG.departmentId,
        classId: ORG.classId,
        academicYear: YEAR,
        period: "YTD",
        subjectId: null,
        subjects: [ORG.mathId, ORG.physicsId],
        avgPct: 61.8,
        nMarks: 38,
        distinctStudents: 10,
      },
    ],
    flags: [
      {
        studentId: "stu_risk",
        academicYear: YEAR,
        ...paths.sectionA,
        attendancePct: 60,
        overallPct: 30,
        subjectPcts: { [ORG.mathId]: 35, [ORG.physicsId]: 25 },
        reasons: ["low-attendance", "low-marks"],
      },
    ],
  });
  directory.positions.set("stu_risk", paths.sectionA);
  return { service, repo, read, directory };
}

describe("rollup serving under closure + cohort", () => {
  it("teacher: attendance and own subject served; physics row absent; overall DENIED", async () => {
    const { service } = await makeService();
    const attendance = await service.nodeAttendance(mathTeacher, ORG.classId, paths.class, YEAR);
    expect(attendance.state).toBe("ok");
    const marks = await service.nodeMarks(mathTeacher, ORG.classId, paths.class, YEAR);
    expect(marks.bySubject.map((row) => row.subjectId)).toEqual([ORG.mathId]);
    expect(marks.overall).toMatchObject({ state: "denied", deniedSubjectId: ORG.physicsId });
  });

  it("class_teacher and hod: overall served under closure", async () => {
    const { service } = await makeService();
    for (const reader of [classTeacher, hod]) {
      const marks = await service.nodeMarks(reader, ORG.classId, paths.class, YEAR);
      expect(marks.overall.state).toBe("ok");
      expect(marks.bySubject).toHaveLength(2);
    }
  });

  it("the minimum-cohort floor withholds for EVERYONE, principal included", async () => {
    const { service } = await makeService({ cohortOverride: 11 });
    const attendance = await service.nodeAttendance(principal, ORG.classId, paths.class, YEAR);
    expect(attendance).toEqual({ state: "insufficient-cohort", minCohort: 11 });
    const marks = await service.nodeMarks(principal, ORG.classId, paths.class, YEAR);
    expect(marks.overall).toEqual({ state: "insufficient-cohort", minCohort: 11 });
  });

  it("small-cohort months drop out of monthly series independently", async () => {
    const { service, repo } = await makeService();
    // Add a tiny-cohort month.
    repo.attendance.push({
      ...repo.attendance[0]!,
      id: "aar_tiny",
      period: "2026-08",
      distinctStudents: 2,
      present: 2,
      absent: 0,
      late: 0,
      excused: 0,
      sessions: 1,
    });
    const attendance = await service.nodeAttendance(classTeacher, ORG.classId, paths.class, YEAR);
    expect(attendance.state).toBe("ok");
    if (attendance.state === "ok") {
      expect(attendance.value.monthly.map((month) => month.month)).toEqual(["2026-07"]);
    }
  });

  it("an all-zero monthly bucket computes 0% instead of dividing by zero", async () => {
    const { service, repo } = await makeService();
    repo.attendance.push({
      ...repo.attendance[0]!,
      id: "aar_zero",
      period: "2026-09",
      sessions: 1,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      distinctStudents: 10,
    });
    const attendance = await service.nodeAttendance(classTeacher, ORG.classId, paths.class, YEAR);
    if (attendance.state === "ok") {
      expect(attendance.value.monthly.find((month) => month.month === "2026-09")?.pct).toBe(0);
    } else {
      expect.unreachable();
    }
  });
});

describe("at-risk field gating", () => {
  it("teacher: attendance flag + own-subject score only; no overall, no low-marks reason", async () => {
    const { service } = await makeService();
    const entries = await service.atRisk(mathTeacher, "class", ORG.classId, YEAR);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      studentId: "stu_risk",
      attendancePct: 60,
      overallPct: null,
      reasons: ["low-attendance"],
    });
    expect(entries[0]?.subjectPcts).toEqual({ [ORG.mathId]: 35 });
  });

  it("class_teacher: full entry including overall and both reasons", async () => {
    const { service } = await makeService();
    const entries = await service.atRisk(classTeacher, "class", ORG.classId, YEAR);
    expect(entries[0]).toMatchObject({
      attendancePct: 60,
      overallPct: 30,
      reasons: ["low-attendance", "low-marks"],
    });
    expect(Object.keys(entries[0]?.subjectPcts ?? {})).toHaveLength(2);
  });

  it("an out-of-scope caller gets nothing at all", async () => {
    const { service } = await makeService();
    const stranger = caller("t-x", ["teacher"], [
      { role: "teacher", org: { collegeId: "col_other", departmentId: "dep_x", classId: "cls_x" }, subjectId: "sub_x" },
    ]);
    expect(await service.atRisk(stranger, "class", ORG.classId, YEAR)).toEqual([]);
  });
});

describe("live student performance (filter-at-source)", () => {
  function seedStudent(read: FakeAcademicsRead, directory: FakeDirectory) {
    directory.positions.set("stu_1", paths.sectionA);
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
        scorePct: 80,
        kind: "exam",
        assessmentName: "Midterm",
        heldOn: "2026-07-01",
        recordedAt: "2026-07-01T10:00:00Z",
        academicYear: YEAR,
        position: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId, subjectId: ORG.mathId },
      },
      {
        markId: "m2",
        studentId: "stu_1",
        scorePct: 40,
        kind: "quiz",
        assessmentName: "Physics Quiz",
        heldOn: "2026-07-02",
        recordedAt: "2026-07-02T10:00:00Z",
        academicYear: YEAR,
        position: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId, subjectId: ORG.physicsId },
      },
    ];
  }

  it("teacher sees attendance + own subject; overall omitted because a mark was filtered", async () => {
    const { service, read, directory } = await makeService();
    seedStudent(read, directory);
    const result = await service.studentPerformance(mathTeacher, "stu_1", YEAR);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.attendance?.pct).toBe(100);
      expect(result.subjects.map((subject) => subject.subjectId)).toEqual([ORG.mathId]);
      expect(result.overallPct).toBeNull(); // closure failed → no overall
    }
  });

  it("class_teacher sees everything including the overall (closure holds)", async () => {
    const { service, read, directory } = await makeService();
    seedStudent(read, directory);
    const result = await service.studentPerformance(classTeacher, "stu_1", YEAR);
    if (result.state === "ok") {
      expect(result.subjects).toHaveLength(2);
      expect(result.overallPct).toBe(60);
    } else {
      expect.unreachable();
    }
  });

  it("handles late-status attendance and marks with no held-on date in the trends", async () => {
    const { service, read, directory } = await makeService();
    directory.positions.set("stu_late", paths.sectionA);
    read.attendance = [
      {
        entryId: "e1",
        studentId: "stu_late",
        status: "late",
        heldOn: "2026-07-01",
        academicYear: YEAR,
        position: { ...paths.class, sectionId: ORG.sectionA },
      },
      {
        entryId: "e2",
        studentId: "stu_late",
        status: "present",
        heldOn: "2026-08-01",
        academicYear: YEAR,
        position: { ...paths.class, sectionId: ORG.sectionA },
      },
    ];
    read.marks = [
      {
        markId: "m1",
        studentId: "stu_late",
        scorePct: 90,
        kind: "assignment",
        assessmentName: "Undated Essay",
        heldOn: null, // sorts by recordedAt
        recordedAt: "2026-07-05T10:00:00Z",
        academicYear: YEAR,
        position: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId, subjectId: ORG.mathId },
      },
      {
        markId: "m2",
        studentId: "stu_late",
        scorePct: 70,
        kind: "exam",
        assessmentName: "Midterm",
        heldOn: "2026-07-10",
        recordedAt: "2026-07-10T10:00:00Z",
        academicYear: YEAR,
        position: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId, subjectId: ORG.mathId },
      },
    ];
    const result = await service.studentPerformance(classTeacher, "stu_late", YEAR);
    if (result.state === "ok") {
      expect(result.attendance?.pct).toBe(100); // late counts as attended
      expect(result.subjects[0]?.series.map((point) => point.label)).toEqual([
        "Undated Essay",
        "Midterm",
      ]);
    } else {
      expect.unreachable();
    }
  });

  it("404 for unknown students; 403 when nothing is visible", async () => {
    const { service, read, directory } = await makeService();
    seedStudent(read, directory);
    expect((await service.studentPerformance(mathTeacher, "stu_ghost", YEAR)).state).toBe("not-found");
    const stranger = caller("t-x", ["teacher"], [
      { role: "teacher", org: { collegeId: "col_other", departmentId: "d", classId: "c" }, subjectId: "s" },
    ]);
    expect((await service.studentPerformance(stranger, "stu_1", YEAR)).state).toBe("denied");
  });
});

describe("node resolution & empty states", () => {
  it("resolves every level and rejects unknown nodes", async () => {
    const { service } = await makeService();
    expect(await service.nodePath("section", ORG.sectionA)).toEqual(paths.sectionA);
    expect(await service.nodePath("class", ORG.classId)).toEqual(paths.class);
    expect(await service.nodePath("department", ORG.departmentId)).toEqual(paths.department);
    expect(await service.nodePath("college", ORG.collegeId)).toEqual(paths.college);
    expect(await service.nodePath("college", "col_ghost")).toBeNull();
    expect(await service.nodePath("section", "sec_ghost")).toBeNull();
  });

  it("nodes without rollup rows serve the no-data state (not an error)", async () => {
    const { service } = await makeService();
    const attendance = await service.nodeAttendance(hod, ORG.departmentId, paths.department, YEAR);
    expect(attendance).toEqual({ state: "no-data" });
    const marks = await service.nodeMarks(hod, ORG.departmentId, paths.department, YEAR);
    expect(marks.bySubject).toEqual([]);
    expect(marks.overall).toEqual({ state: "no-data" });
  });
});

describe("at-risk gating edges", () => {
  it("a marks-only flag is INVISIBLE to a subject teacher (their reason set is empty)", async () => {
    const { service, repo } = await makeService();
    repo.flags.push({
      ...repo.flags[0]!,
      id: "afl_marksonly",
      studentId: "stu_marks_only",
      attendancePct: null,
      reasons: ["low-marks"],
    });
    const teacherView = await service.atRisk(mathTeacher, "class", ORG.classId, YEAR);
    expect(teacherView.map((entry) => entry.studentId)).toEqual(["stu_risk"]);
    // ...while the class_teacher sees it with the overall figure.
    const ctView = await service.atRisk(classTeacher, "class", ORG.classId, YEAR);
    expect(ctView.map((entry) => entry.studentId).sort()).toEqual(["stu_marks_only", "stu_risk"]);
  });

  it("a college-anchored flag (unenrolled student) is visible only to college-wide readers", async () => {
    const { service, repo } = await makeService();
    repo.flags.push({
      id: "afl_unenrolled",
      studentId: "stu_unenrolled",
      academicYear: YEAR,
      collegeId: ORG.collegeId,
      departmentId: null,
      classId: null,
      sectionId: null,
      attendancePct: "50.00",
      overallPct: null,
      subjectPcts: {},
      reasons: ["low-attendance"],
      computedAt: new Date(),
    });
    const principalView = await service.atRisk(principal, "college", ORG.collegeId, YEAR);
    expect(principalView.map((entry) => entry.studentId)).toContain("stu_unenrolled");
    // Name falls back to the id (no directory record for this student).
    expect(principalView.find((entry) => entry.studentId === "stu_unenrolled")?.name).toBe(
      "stu_unenrolled",
    );
    const teacherView = await service.atRisk(mathTeacher, "college", ORG.collegeId, YEAR);
    expect(teacherView.map((entry) => entry.studentId)).not.toContain("stu_unenrolled");
  });

  it("unflagged students never appear", async () => {
    const { service, repo } = await makeService();
    repo.flags.push({ ...repo.flags[0]!, id: "afl_fine", studentId: "stu_fine", reasons: [] });
    const entries = await service.atRisk(classTeacher, "class", ORG.classId, YEAR);
    expect(entries.map((entry) => entry.studentId)).not.toContain("stu_fine");
  });

  it("sorts a mix of null-attendance (marks-only) and attendance entries without crashing", async () => {
    const { service, repo } = await makeService();
    // Two marks-only entries (null attendance) alongside the seeded one.
    repo.flags.push(
      { ...repo.flags[0]!, id: "afl_m1", studentId: "stu_m1", attendancePct: null, reasons: ["low-marks"] },
      { ...repo.flags[0]!, id: "afl_m2", studentId: "stu_m2", attendancePct: null, reasons: ["low-marks"] },
    );
    const entries = await service.atRisk(classTeacher, "class", ORG.classId, YEAR);
    // The one with attendance (60) sorts before the null-attendance ones (→100).
    expect(entries[0]?.studentId).toBe("stu_risk");
    expect(entries).toHaveLength(3);
  });
});

describe("student performance edges", () => {
  it("marks-only students (no attendance rows) still serve", async () => {
    const { service, read, directory } = await makeService();
    directory.positions.set("stu_m", paths.sectionA);
    read.marks = [
      {
        markId: "m9",
        studentId: "stu_m",
        scorePct: 55,
        kind: "assignment",
        assessmentName: "Essay",
        heldOn: null,
        recordedAt: "2026-07-03T10:00:00Z",
        academicYear: YEAR,
        position: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId, subjectId: ORG.mathId },
      },
    ];
    const result = await service.studentPerformance(classTeacher, "stu_m", YEAR);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.attendance).toBeNull();
      expect(result.overallPct).toBe(55);
      expect(result.subjects[0]?.series[0]?.label).toBe("Essay");
    }
  });
});

describe("dashboard — the permission mirror", () => {
  it("tiles are derived from grants: a teacher gets exactly their class+subject tile", async () => {
    const { service } = await makeService();
    const dashboard = await service.dashboard(mathTeacher, YEAR);
    expect(dashboard.tiles).toHaveLength(1);
    expect(dashboard.tiles[0]).toMatchObject({
      type: "teacher-class",
      classId: ORG.classId,
      subjectId: ORG.mathId,
    });
    const tile = dashboard.tiles[0] as { marks: { state: string }; attendance: { state: string }; atRisk: number };
    expect(tile.attendance.state).toBe("ok");
    expect(tile.marks.state).toBe("ok");
    expect(tile.atRisk).toBe(1);
    expect(dashboard.names[ORG.classId]).toBe("BSc Year 1");
  });

  it("hod and principal get their level's tile; duplicate grants dedupe at every level", async () => {
    const { service } = await makeService();
    const hodDash = await service.dashboard(hod, YEAR);
    expect(hodDash.tiles.map((tile) => tile.type)).toEqual(["department"]);
    const twoGrants = caller("p-2", ["principal", "admin"], [
      { role: "principal", org: paths.college },
      { role: "admin", org: paths.college },
    ]);
    const dash = await service.dashboard(twoGrants, YEAR);
    expect(dash.tiles.map((tile) => tile.type)).toEqual(["college"]);
    // Duplicate class_teacher and hod grants dedupe to one tile each.
    const dupes = caller("dupe", ["class_teacher", "hod"], [
      { role: "class_teacher", org: paths.class },
      { role: "class_teacher", org: paths.class },
      { role: "hod", org: paths.department },
      { role: "hod", org: paths.department },
    ]);
    const dupeDash = await service.dashboard(dupes, YEAR);
    expect(dupeDash.tiles.map((tile) => tile.type).sort()).toEqual(["class", "department"]);
  });

  it("malformed or duplicate grants are skipped/deduped without crashing", async () => {
    const { service } = await makeService();
    const odd = caller("odd", ["teacher"], [
      { role: "teacher", org: paths.class, subjectId: ORG.mathId },
      { role: "teacher", org: paths.class, subjectId: ORG.mathId }, // duplicate
      { role: "teacher", org: paths.college, subjectId: ORG.mathId }, // no classId → skipped
      { role: "class_teacher", org: paths.department }, // no classId → skipped
      { role: "hod", org: paths.college }, // no departmentId → skipped
    ]);
    const dashboard = await service.dashboard(odd, YEAR);
    expect(dashboard.tiles).toHaveLength(1);
  });

  it("a teacher tile with no marks rollup shows the no-data slot", async () => {
    const { service, repo } = await makeService();
    repo.marks = repo.marks.filter((row) => row.subjectId !== ORG.mathId);
    const dashboard = await service.dashboard(mathTeacher, YEAR);
    const tile = dashboard.tiles[0] as { marks: { state: string } };
    expect(tile.marks.state).toBe("no-data");
  });

  it("register strip cells below the cohort floor are omitted", async () => {
    const { service, read } = await makeService();
    read.density.set(ORG.sectionA, [
      { heldOn: "2026-07-02", slot: "day", presentPct: 90, students: 30 },
      { heldOn: "2026-07-01", slot: "day", presentPct: 100, students: 3 },
    ]);
    const dashboard = await service.dashboard(classTeacher, YEAR);
    const tile = dashboard.tiles[0] as {
      strip: { sectionId: string; days: { heldOn: string }[] }[];
    };
    const sectionA = tile.strip.find((row) => row.sectionId === ORG.sectionA);
    expect(sectionA?.days.map((day) => day.heldOn)).toEqual(["2026-07-02"]);
  });
});

describe("QueryService.childrenRollups", () => {
  it("returns null for an unknown parent node", async () => {
    const { service } = await makeService();
    expect(await service.childrenRollups(principal, "college", "col_ghost", YEAR)).toBeNull();
  });

  it("lists a college's departments with per-child served aggregates", async () => {
    const { repo, service } = await makeService();
    await repo.replaceYear(YEAR, {
      attendance: [{
        scopeLevel: "department", nodeId: ORG.departmentId, ...paths.department,
        academicYear: YEAR, period: "YTD", sessions: 10, present: 90, absent: 10, late: 0, excused: 0, distinctStudents: 8,
      }],
      marks: [], flags: [],
    });
    const result = await service.childrenRollups(principal, "college", ORG.collegeId, YEAR);
    expect(result).not.toBeNull();
    expect(result!.childLevel).toBe("department");
    expect(result!.children).toHaveLength(1);
    expect(result!.children[0]!.name).toBe("Science");
    expect(result!.children[0]!.attendance.state).toBe("ok");
  });
});
