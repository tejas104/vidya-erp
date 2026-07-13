/**
 * In-memory TEST DOUBLES for the analytics module. The real ScopeChecker
 * is exercised by src/aggregation-scope.test.ts (the ADR-0018 proof) and
 * the integration suite; these fakes exercise the plumbing.
 */

import type { AuditEvent, AuditLogger, OrgPath } from "@vidya/platform";
import type {
  AcademicsReadModel,
  AttendanceRecordView,
  MarkRecordView,
} from "@vidya/module-academics";
import type { PeopleDirectory } from "@vidya/module-people";
import type {
  NewAttendanceRollup,
  NewMarksRollup,
  NewStudentFlag,
  RollupsRepo,
  ScopeLevel,
} from "../src/repo/rollups-repo";
import type {
  AnlAttendanceRollupRow,
  AnlMarksRollupRow,
  AnlStudentFlagRow,
} from "../src/db/schema";

export class RecordingAudit implements AuditLogger {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  actions(): string[] {
    return this.events.map((event) => event.action);
  }
}

export const ORG = {
  collegeId: "col_1",
  departmentId: "dep_sci",
  classId: "cls_10a",
  sectionA: "sec_a",
  sectionB: "sec_b",
  mathId: "sub_math",
  physicsId: "sub_phys",
} as const;

export const paths = {
  sectionA: {
    collegeId: ORG.collegeId,
    departmentId: ORG.departmentId,
    classId: ORG.classId,
    sectionId: ORG.sectionA,
  },
  sectionB: {
    collegeId: ORG.collegeId,
    departmentId: ORG.departmentId,
    classId: ORG.classId,
    sectionId: ORG.sectionB,
  },
  class: { collegeId: ORG.collegeId, departmentId: ORG.departmentId, classId: ORG.classId },
  department: { collegeId: ORG.collegeId, departmentId: ORG.departmentId },
  college: { collegeId: ORG.collegeId },
} as const;

export class FakeAcademicsRead implements AcademicsReadModel {
  attendance: AttendanceRecordView[] = [];
  marks: MarkRecordView[] = [];
  density = new Map<string, { heldOn: string; slot: string; presentPct: number; students: number }[]>();

  async attendancePage(academicYear: string, after: string | null, limit: number) {
    const rows = this.attendance
      .filter((row) => row.academicYear === academicYear)
      .sort((a, b) => a.entryId.localeCompare(b.entryId))
      .filter((row) => after === null || row.entryId > after)
      .slice(0, limit);
    return { rows, nextAfter: rows.length === limit ? (rows[rows.length - 1]?.entryId ?? null) : null };
  }

  async marksPage(academicYear: string, after: string | null, limit: number) {
    const rows = this.marks
      .filter((row) => row.academicYear === academicYear)
      .sort((a, b) => a.markId.localeCompare(b.markId))
      .filter((row) => after === null || row.markId > after)
      .slice(0, limit);
    return { rows, nextAfter: rows.length === limit ? (rows[rows.length - 1]?.markId ?? null) : null };
  }

  async studentAttendance(studentId: string, academicYear?: string) {
    return this.attendance.filter(
      (row) =>
        row.studentId === studentId &&
        (academicYear === undefined || row.academicYear === academicYear),
    );
  }

  async studentMarks(studentId: string, academicYear?: string) {
    return this.marks.filter(
      (row) =>
        row.studentId === studentId &&
        (academicYear === undefined || row.academicYear === academicYear),
    );
  }

  async sectionRecentDensity(sectionId: string, limit: number) {
    return (this.density.get(sectionId) ?? []).slice(0, limit);
  }
}

export class FakeDirectory implements PeopleDirectory {
  readonly positions = new Map<string, OrgPath>();
  readonly names = new Map<string, string>([
    [ORG.collegeId, "Test College"],
    [ORG.departmentId, "Science"],
    [ORG.classId, "BSc Year 1"],
    [ORG.sectionA, "A"],
    [ORG.sectionB, "B"],
    [ORG.mathId, "Mathematics"],
    [ORG.physicsId, "Physics"],
  ]);

  async sectionPath(sectionId: string): Promise<OrgPath | null> {
    if (sectionId === ORG.sectionA) return paths.sectionA;
    if (sectionId === ORG.sectionB) return paths.sectionB;
    return null;
  }
  async classPath(classId: string): Promise<OrgPath | null> {
    return classId === ORG.classId ? paths.class : null;
  }
  async departmentPath(departmentId: string): Promise<OrgPath | null> {
    return departmentId === ORG.departmentId ? paths.department : null;
  }
  async collegeExists(collegeId: string): Promise<boolean> {
    return collegeId === ORG.collegeId;
  }
  roster: { studentId: string; academicYear: string }[] = [];
  async sectionRoster(sectionId: string) {
    return sectionId === ORG.sectionA ? this.roster : [];
  }
  async studentPosition(studentId: string): Promise<OrgPath | null> {
    return this.positions.get(studentId) ?? null;
  }
  async studentByIdentityUser(): Promise<{
    studentId: string;
    collegeId: string;
    fullName: string;
    admissionNo: string;
    status: string;
  } | null> {
    return null;
  }

  async teacherByIdentityUser(): Promise<{ teacherId: string; collegeId: string; fullName: string } | null> {
    return null;
  }
  async studentsExist(studentIds: readonly string[]): Promise<Set<string>> {
    return new Set(studentIds.filter((id) => this.positions.has(id)));
  }
  async teacherDepartments(): Promise<string[]> {
    return [ORG.departmentId];
  }
  async studentsBrief(
    studentIds: readonly string[],
  ): Promise<Map<string, { fullName: string; admissionNo: string }>> {
    const briefs = new Map<string, { fullName: string; admissionNo: string }>();
    for (const id of studentIds) {
      if (this.positions.has(id)) briefs.set(id, { fullName: `Student ${id}`, admissionNo: id });
    }
    return briefs;
  }
  async subjectDepartment(subjectId: string): Promise<string | null> {
    return subjectId === ORG.mathId || subjectId === ORG.physicsId ? ORG.departmentId : null;
  }
  async sectionsWithLiveEnrollment(): Promise<string[]> {
    return [ORG.sectionA, ORG.sectionB];
  }
  async sectionsOfClass(classId: string) {
    return classId === ORG.classId
      ? [
          { sectionId: ORG.sectionA, name: "A" },
          { sectionId: ORG.sectionB, name: "B" },
        ]
      : [];
  }
  async departmentsOfCollege(collegeId: string) {
    return collegeId === ORG.collegeId ? [{ departmentId: ORG.departmentId, name: "Science" }] : [];
  }
  async classesOfDepartment(departmentId: string) {
    return departmentId === ORG.departmentId ? [{ classId: ORG.classId, name: "BSc Year 1" }] : [];
  }
  async namesFor(ids: readonly string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const id of ids) {
      const name = this.names.get(id) ?? (this.positions.has(id) ? `Student ${id}` : undefined);
      if (name !== undefined) {
        result.set(id, name);
      }
    }
    return result;
  }
}

let rollupSeq = 0;

export class InMemoryRollupsRepo implements RollupsRepo {
  attendance: AnlAttendanceRollupRow[] = [];
  marks: AnlMarksRollupRow[] = [];
  flags: AnlStudentFlagRow[] = [];

  async replaceYear(
    academicYear: string,
    data: {
      attendance: readonly NewAttendanceRollup[];
      marks: readonly NewMarksRollup[];
      flags: readonly NewStudentFlag[];
    },
  ): Promise<void> {
    this.attendance = this.attendance.filter((row) => row.academicYear !== academicYear);
    this.marks = this.marks.filter((row) => row.academicYear !== academicYear);
    this.flags = this.flags.filter((row) => row.academicYear !== academicYear);
    for (const row of data.attendance) {
      this.attendance.push({
        id: `aar_${rollupSeq++}`,
        scopeLevel: row.scopeLevel,
        nodeId: row.nodeId,
        collegeId: row.collegeId,
        departmentId: row.departmentId ?? null,
        classId: row.classId ?? null,
        sectionId: row.sectionId ?? null,
        academicYear: row.academicYear,
        period: row.period,
        sessions: row.sessions,
        present: row.present,
        absent: row.absent,
        late: row.late,
        excused: row.excused,
        distinctStudents: row.distinctStudents,
        computedAt: new Date(),
      });
    }
    for (const row of data.marks) {
      this.marks.push({
        id: `amr_${rollupSeq++}`,
        scopeLevel: row.scopeLevel,
        nodeId: row.nodeId,
        collegeId: row.collegeId,
        departmentId: row.departmentId ?? null,
        classId: row.classId ?? null,
        academicYear: row.academicYear,
        period: row.period,
        subjectId: row.subjectId,
        subjects: [...row.subjects],
        avgPct: row.avgPct.toFixed(2),
        nMarks: row.nMarks,
        distinctStudents: row.distinctStudents,
        computedAt: new Date(),
      });
    }
    for (const row of data.flags) {
      this.flags.push({
        id: `afl_${rollupSeq++}`,
        studentId: row.studentId,
        academicYear: row.academicYear,
        collegeId: row.collegeId,
        departmentId: row.departmentId ?? null,
        classId: row.classId ?? null,
        sectionId: row.sectionId ?? null,
        attendancePct: row.attendancePct === null ? null : row.attendancePct.toFixed(2),
        overallPct: row.overallPct === null ? null : row.overallPct.toFixed(2),
        subjectPcts: row.subjectPcts,
        reasons: [...row.reasons],
        computedAt: new Date(),
      });
    }
  }

  async attendanceForNode(nodeId: string, academicYear: string) {
    return this.attendance.filter(
      (row) => row.nodeId === nodeId && row.academicYear === academicYear,
    );
  }

  async marksForNode(nodeId: string, academicYear: string) {
    return this.marks.filter((row) => row.nodeId === nodeId && row.academicYear === academicYear);
  }

  async flagsForClass(classId: string, academicYear: string) {
    return this.flags.filter(
      (row) => row.classId === classId && row.academicYear === academicYear,
    );
  }

  async flagsUnder(level: ScopeLevel, nodeId: string, academicYear: string) {
    return this.flags.filter((row) => {
      if (row.academicYear !== academicYear) return false;
      switch (level) {
        case "section":
          return row.sectionId === nodeId;
        case "class":
          return row.classId === nodeId;
        case "department":
          return row.departmentId === nodeId;
        case "college":
          return row.collegeId === nodeId;
      }
    });
  }

  async flagForStudent(studentId: string, academicYear: string) {
    return (
      this.flags.find(
        (row) => row.studentId === studentId && row.academicYear === academicYear,
      ) ?? null
    );
  }
}
