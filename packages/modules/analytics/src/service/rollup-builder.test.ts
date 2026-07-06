import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { AttendanceRecordView, MarkRecordView } from "@vidya/module-academics";
import { RollupBuilder } from "./rollup-builder";
import {
  FakeAcademicsRead,
  FakeDirectory,
  InMemoryRollupsRepo,
  ORG,
  RecordingAudit,
  paths,
} from "../../test-support/fakes";

const log = pino({ level: "silent" });
const YEAR = "2026-27";

function attendanceRow(
  id: string,
  studentId: string,
  status: AttendanceRecordView["status"],
  heldOn: string,
  sectionId: string = ORG.sectionA,
): AttendanceRecordView {
  return {
    entryId: id,
    studentId,
    status,
    heldOn,
    academicYear: YEAR,
    position: { ...paths.class, sectionId },
  };
}

function markRow(
  id: string,
  studentId: string,
  scorePct: number,
  subjectId: string = ORG.mathId,
): MarkRecordView {
  return {
    markId: id,
    studentId,
    scorePct,
    kind: "exam",
    assessmentName: "Midterm",
    heldOn: "2026-07-01",
    recordedAt: "2026-07-01T10:00:00Z",
    academicYear: YEAR,
    position: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId, subjectId },
  };
}

async function build(read: FakeAcademicsRead) {
  const repo = new InMemoryRollupsRepo();
  const audit = new RecordingAudit();
  const directory = new FakeDirectory();
  directory.positions.set("stu_1", { ...paths.class, sectionId: ORG.sectionA });
  directory.positions.set("stu_2", { ...paths.class, sectionId: ORG.sectionA });
  const builder = new RollupBuilder({
    academicsRead: read,
    directory,
    repo,
    audit,
    thresholds: { attendanceThreshold: 75, marksThreshold: 40 },
  });
  const result = await builder.build(YEAR, log);
  return { repo, audit, result };
}

describe("RollupBuilder", () => {
  it("rolls attendance up section→class→department→college with YTD + monthly buckets", async () => {
    const read = new FakeAcademicsRead();
    read.attendance = [
      attendanceRow("e1", "stu_1", "present", "2026-07-01"),
      attendanceRow("e2", "stu_2", "absent", "2026-07-01"),
      attendanceRow("e3", "stu_1", "late", "2026-08-02"),
      attendanceRow("e4", "stu_2", "present", "2026-08-02", ORG.sectionB),
    ];
    const { repo } = await build(read);

    const sectionYtd = repo.attendance.find(
      (row) => row.nodeId === ORG.sectionA && row.period === "YTD",
    );
    expect(sectionYtd).toMatchObject({ present: 1, absent: 1, late: 1, sessions: 2, distinctStudents: 2 });

    const collegeYtd = repo.attendance.find(
      (row) => row.nodeId === ORG.collegeId && row.period === "YTD",
    );
    expect(collegeYtd).toMatchObject({ present: 2, absent: 1, late: 1, distinctStudents: 2 });

    const julyClass = repo.attendance.find(
      (row) => row.nodeId === ORG.classId && row.period === "2026-07",
    );
    expect(julyClass).toMatchObject({ present: 1, absent: 1, late: 0 });
  });

  it("builds per-subject AND cross-subject marks rollups, recording constituents", async () => {
    const read = new FakeAcademicsRead();
    read.marks = [
      markRow("m1", "stu_1", 80, ORG.mathId),
      markRow("m2", "stu_2", 60, ORG.mathId),
      markRow("m3", "stu_1", 40, ORG.physicsId),
    ];
    const { repo } = await build(read);

    const mathClass = repo.marks.find(
      (row) => row.nodeId === ORG.classId && row.period === "YTD" && row.subjectId === ORG.mathId,
    );
    expect(mathClass).toMatchObject({ nMarks: 2, distinctStudents: 2 });
    expect(Number(mathClass?.avgPct)).toBe(70);

    const cross = repo.marks.find(
      (row) => row.nodeId === ORG.classId && row.period === "YTD" && row.subjectId === null,
    );
    expect(cross).toMatchObject({ nMarks: 3 });
    expect(Number(cross?.avgPct)).toBe(60);
    expect(cross?.subjects).toEqual([ORG.mathId, ORG.physicsId]);
  });

  it("flags students against thresholds with current positions", async () => {
    const read = new FakeAcademicsRead();
    read.attendance = [
      attendanceRow("e1", "stu_1", "absent", "2026-07-01"),
      attendanceRow("e2", "stu_1", "absent", "2026-07-02"),
      attendanceRow("e3", "stu_1", "present", "2026-07-03"),
      attendanceRow("e4", "stu_2", "present", "2026-07-01"),
    ];
    read.marks = [markRow("m1", "stu_2", 25, ORG.mathId)];
    const { repo } = await build(read);

    const flagged = repo.flags.find((row) => row.studentId === "stu_1");
    expect(Number(flagged?.attendancePct)).toBeCloseTo(33.3, 1);
    expect(flagged?.reasons).toEqual(["low-attendance"]);
    expect(flagged?.sectionId).toBe(ORG.sectionA); // current position from the directory

    const lowMarks = repo.flags.find((row) => row.studentId === "stu_2");
    expect(lowMarks?.reasons).toEqual(["low-marks"]);
    expect((lowMarks?.subjectPcts as Record<string, number>)[ORG.mathId]).toBe(25);
  });

  it("counts excused sessions and handles marks with no held-on date", async () => {
    const read = new FakeAcademicsRead();
    read.attendance = [
      attendanceRow("e1", "stu_1", "excused", "2026-07-01"),
      attendanceRow("e2", "stu_2", "excused", "2026-07-01"),
    ];
    read.marks = [{ ...markRow("m1", "stu_1", 70), heldOn: null }];
    const { repo } = await build(read);
    const section = repo.attendance.find((row) => row.nodeId === ORG.sectionA && row.period === "YTD");
    expect(section?.excused).toBe(2);
    // heldOn null → the mark buckets by its recordedAt month instead.
    const monthBucket = repo.marks.find(
      (row) => row.nodeId === ORG.classId && row.period === "2026-07" && row.subjectId === ORG.mathId,
    );
    expect(monthBucket).toBeDefined();
  });

  it("falls back to a record position when the student has no live enrollment", async () => {
    const read = new FakeAcademicsRead();
    // 'stu_gone' has records but is absent from the directory (no current position).
    read.attendance = [
      attendanceRow("e1", "stu_gone", "absent", "2026-07-01"),
      attendanceRow("e2", "stu_gone", "absent", "2026-07-02"),
    ];
    const repo = new InMemoryRollupsRepo();
    const directory = new FakeDirectory(); // stu_gone not registered
    const builder = new RollupBuilder({
      academicsRead: read,
      directory,
      repo,
      audit: new (await import("../../test-support/fakes")).RecordingAudit(),
      thresholds: { attendanceThreshold: 75, marksThreshold: 40 },
    });
    await builder.build(YEAR, log);
    const flag = repo.flags.find((row) => row.studentId === "stu_gone");
    // Position taken from the attendance record (section-level).
    expect(flag?.sectionId).toBe(ORG.sectionA);
    expect(flag?.reasons).toEqual(["low-attendance"]);
  });

  it("a marks-only student (no live position) gets a class-level fallback and null overall attendance", async () => {
    const read = new FakeAcademicsRead();
    read.marks = [markRow("m1", "stu_marks", 30, ORG.mathId)];
    const repo = new InMemoryRollupsRepo();
    const directory = new FakeDirectory(); // stu_marks not registered
    const builder = new RollupBuilder({
      academicsRead: read,
      directory,
      repo,
      audit: new (await import("../../test-support/fakes")).RecordingAudit(),
      thresholds: { attendanceThreshold: 75, marksThreshold: 40 },
    });
    await builder.build(YEAR, log);
    const flag = repo.flags.find((row) => row.studentId === "stu_marks");
    expect(flag?.attendancePct).toBeNull(); // no attendance records
    expect(flag?.sectionId).toBeNull(); // marks position is class-level, no section
    expect(flag?.classId).toBe(ORG.classId);
    expect(Number(flag?.overallPct)).toBe(30);
    expect(flag?.reasons).toEqual(["low-marks"]);
  });

  it("an attendance-only student has a null overall marks percentage", async () => {
    const read = new FakeAcademicsRead();
    read.attendance = [attendanceRow("e1", "stu_att", "present", "2026-07-01")];
    const repo = new InMemoryRollupsRepo();
    const directory = new FakeDirectory();
    directory.positions.set("stu_att", paths.sectionA);
    const builder = new RollupBuilder({
      academicsRead: read,
      directory,
      repo,
      audit: new (await import("../../test-support/fakes")).RecordingAudit(),
      thresholds: { attendanceThreshold: 75, marksThreshold: 40 },
    });
    await builder.build(YEAR, log);
    const flag = repo.flags.find((row) => row.studentId === "stu_att");
    expect(flag?.overallPct).toBeNull();
    expect(flag?.reasons).toEqual([]); // 100% attendance, no marks → not at risk
  });

  it("is idempotent per year and audits the rebuild", async () => {
    const read = new FakeAcademicsRead();
    read.attendance = [attendanceRow("e1", "stu_1", "present", "2026-07-01")];
    const repo = new InMemoryRollupsRepo();
    const audit = new RecordingAudit();
    const directory = new FakeDirectory();
    directory.positions.set("stu_1", paths.sectionA);
    const builder = new RollupBuilder({
      academicsRead: read,
      directory,
      repo,
      audit,
      thresholds: { attendanceThreshold: 75, marksThreshold: 40 },
    });
    await builder.build(YEAR, log);
    const countAfterFirst = repo.attendance.length;
    await builder.build(YEAR, log);
    expect(repo.attendance.length).toBe(countAfterFirst);
    expect(audit.actions()).toEqual(["analytics.rollups-rebuilt", "analytics.rollups-rebuilt"]);
  });

  it("pages through large attendance AND marks inputs (keyset, multiple pages)", async () => {
    const read = new FakeAcademicsRead();
    for (let index = 0; index < 12_345; index += 1) {
      read.attendance.push(
        attendanceRow(`e${String(index).padStart(6, "0")}`, `stu_${index % 40}`, "present", "2026-07-01"),
      );
    }
    for (let index = 0; index < 6_001; index += 1) {
      read.marks.push(markRow(`m${String(index).padStart(6, "0")}`, `stu_${index % 40}`, 60, ORG.mathId));
    }
    const { repo } = await build(read);
    const ytd = repo.attendance.find((row) => row.nodeId === ORG.sectionA && row.period === "YTD");
    expect(ytd?.present).toBe(12_345);
    expect(ytd?.distinctStudents).toBe(40);
    const mathClass = repo.marks.find(
      (row) => row.nodeId === ORG.classId && row.period === "YTD" && row.subjectId === ORG.mathId,
    );
    expect(mathClass?.nMarks).toBe(6_001);
  });

  it("keeps a college-only position when that is all the directory knows", async () => {
    const read = new FakeAcademicsRead();
    read.marks = [markRow("m1", "stu_col", 30, ORG.mathId)];
    const repo = new InMemoryRollupsRepo();
    const directory = new FakeDirectory();
    directory.positions.set("stu_col", { collegeId: ORG.collegeId }); // college-only
    const builder = new RollupBuilder({
      academicsRead: read,
      directory,
      repo,
      audit: new (await import("../../test-support/fakes")).RecordingAudit(),
      thresholds: { attendanceThreshold: 75, marksThreshold: 40 },
    });
    await builder.build(YEAR, log);
    const flag = repo.flags.find((row) => row.studentId === "stu_col");
    expect(flag?.collegeId).toBe(ORG.collegeId);
    expect(flag?.departmentId).toBeNull();
    expect(flag?.classId).toBeNull();
    expect(flag?.sectionId).toBeNull();
  });
});
