import type { AuditLogger, Logger } from "@vidya/platform";
import type { AcademicsReadModel } from "@vidya/module-academics";
import type { PeopleDirectory } from "@vidya/module-people";
import type {
  NewAttendanceRollup,
  NewMarksRollup,
  NewStudentFlag,
  RollupsRepo,
  ScopeLevel,
} from "../repo/rollups-repo";

const PAGE_SIZE = 5000;
const YTD = "YTD";

export interface RollupBuilderDeps {
  readonly academicsRead: AcademicsReadModel;
  readonly directory: PeopleDirectory;
  readonly repo: RollupsRepo;
  readonly audit: AuditLogger;
  readonly thresholds: {
    readonly attendanceThreshold: number;
    readonly marksThreshold: number;
  };
}

interface AttendanceAcc {
  sessionsKeys: Set<string>;
  present: number;
  absent: number;
  late: number;
  excused: number;
  students: Set<string>;
}

interface MarksAcc {
  sumPct: number;
  n: number;
  students: Set<string>;
  subjects: Set<string>;
}

interface StudentAcc {
  position: { collegeId: string; departmentId?: string; classId?: string; sectionId?: string };
  attended: number;
  attendanceTotal: number;
  subjectSums: Map<string, { sum: number; n: number }>;
}

interface NodeKey {
  readonly level: ScopeLevel;
  readonly nodeId: string;
  readonly collegeId: string;
  readonly departmentId?: string;
  readonly classId?: string;
  readonly sectionId?: string;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The nightly precomputation (ADR-0018): pages every attendance entry and
 * mark of the year through #4's PUBLIC read model and folds them into
 * per-node rollups (section→college for attendance, class→college for
 * marks; YTD + monthly buckets) plus per-student at-risk flags.
 *
 * Computation is deliberately blind — it runs as a system actor over
 * everything. Disclosure happens ONLY in the serving layer
 * (query-service.ts), under constituent-closure + minimum-cohort.
 */
export class RollupBuilder {
  constructor(private readonly deps: RollupBuilderDeps) {}

  async build(academicYear: string, log: Logger): Promise<{
    attendanceRollups: number;
    marksRollups: number;
    flags: number;
  }> {
    const attendanceAcc = new Map<string, { key: NodeKey; period: string; acc: AttendanceAcc }>();
    const marksAcc = new Map<
      string,
      { key: NodeKey; period: string; subjectId: string | null; acc: MarksAcc }
    >();
    const students = new Map<string, StudentAcc>();

    const bumpAttendance = (key: NodeKey, period: string, sessionKey: string, status: string, studentId: string) => {
      const mapKey = `${key.nodeId}|${period}`;
      let slot = attendanceAcc.get(mapKey);
      if (slot === undefined) {
        slot = {
          key,
          period,
          acc: { sessionsKeys: new Set(), present: 0, absent: 0, late: 0, excused: 0, students: new Set() },
        };
        attendanceAcc.set(mapKey, slot);
      }
      slot.acc.sessionsKeys.add(sessionKey);
      slot.acc.students.add(studentId);
      if (status === "present") slot.acc.present += 1;
      else if (status === "absent") slot.acc.absent += 1;
      else if (status === "late") slot.acc.late += 1;
      else slot.acc.excused += 1;
    };

    const bumpMarks = (key: NodeKey, period: string, subjectId: string | null, scorePct: number, studentId: string, realSubject: string) => {
      const mapKey = `${key.nodeId}|${period}|${subjectId ?? "*"}`;
      let slot = marksAcc.get(mapKey);
      if (slot === undefined) {
        slot = { key, period, subjectId, acc: { sumPct: 0, n: 0, students: new Set(), subjects: new Set() } };
        marksAcc.set(mapKey, slot);
      }
      slot.acc.sumPct += scorePct;
      slot.acc.n += 1;
      slot.acc.students.add(studentId);
      slot.acc.subjects.add(realSubject);
    };

    // ---- attendance pass -------------------------------------------------
    let after: string | null = null;
    let attendanceRows = 0;
    for (;;) {
      const page = await this.deps.academicsRead.attendancePage(academicYear, after, PAGE_SIZE);
      for (const row of page.rows) {
        attendanceRows += 1;
        const p = row.position;
        const month = row.heldOn.slice(0, 7);
        const sessionKey = `${p.sectionId}|${row.heldOn}`;
        const nodes: NodeKey[] = [
          { level: "section", nodeId: p.sectionId, collegeId: p.collegeId, departmentId: p.departmentId, classId: p.classId, sectionId: p.sectionId },
          { level: "class", nodeId: p.classId, collegeId: p.collegeId, departmentId: p.departmentId, classId: p.classId },
          { level: "department", nodeId: p.departmentId, collegeId: p.collegeId, departmentId: p.departmentId },
          { level: "college", nodeId: p.collegeId, collegeId: p.collegeId },
        ];
        for (const node of nodes) {
          bumpAttendance(node, YTD, sessionKey, row.status, row.studentId);
          bumpAttendance(node, month, sessionKey, row.status, row.studentId);
        }
        let student = students.get(row.studentId);
        if (student === undefined) {
          student = { position: p, attended: 0, attendanceTotal: 0, subjectSums: new Map() };
          students.set(row.studentId, student);
        }
        student.attendanceTotal += 1;
        if (row.status === "present" || row.status === "late") {
          student.attended += 1;
        }
      }
      if (page.nextAfter === null) break;
      after = page.nextAfter;
    }

    // ---- marks pass -------------------------------------------------------
    after = null;
    let markRows = 0;
    for (;;) {
      const page = await this.deps.academicsRead.marksPage(academicYear, after, PAGE_SIZE);
      for (const row of page.rows) {
        markRows += 1;
        const p = row.position;
        const month = (row.heldOn ?? row.recordedAt).slice(0, 7);
        const nodes: NodeKey[] = [
          { level: "class", nodeId: p.classId, collegeId: p.collegeId, departmentId: p.departmentId, classId: p.classId },
          { level: "department", nodeId: p.departmentId, collegeId: p.collegeId, departmentId: p.departmentId },
          { level: "college", nodeId: p.collegeId, collegeId: p.collegeId },
        ];
        for (const node of nodes) {
          for (const period of [YTD, month]) {
            bumpMarks(node, period, p.subjectId, row.scorePct, row.studentId, p.subjectId);
            bumpMarks(node, period, null, row.scorePct, row.studentId, p.subjectId);
          }
        }
        let student = students.get(row.studentId);
        if (student === undefined) {
          student = {
            position: { collegeId: p.collegeId, departmentId: p.departmentId, classId: p.classId },
            attended: 0,
            attendanceTotal: 0,
            subjectSums: new Map(),
          };
          students.set(row.studentId, student);
        }
        const subject = student.subjectSums.get(p.subjectId) ?? { sum: 0, n: 0 };
        subject.sum += row.scorePct;
        subject.n += 1;
        student.subjectSums.set(p.subjectId, subject);
      }
      if (page.nextAfter === null) break;
      after = page.nextAfter;
    }

    // ---- fold ------------------------------------------------------------
    const attendance: NewAttendanceRollup[] = [...attendanceAcc.values()].map((slot) => ({
      scopeLevel: slot.key.level,
      nodeId: slot.key.nodeId,
      collegeId: slot.key.collegeId,
      ...(slot.key.departmentId !== undefined ? { departmentId: slot.key.departmentId } : {}),
      ...(slot.key.classId !== undefined ? { classId: slot.key.classId } : {}),
      ...(slot.key.sectionId !== undefined ? { sectionId: slot.key.sectionId } : {}),
      academicYear,
      period: slot.period,
      sessions: slot.acc.sessionsKeys.size,
      present: slot.acc.present,
      absent: slot.acc.absent,
      late: slot.acc.late,
      excused: slot.acc.excused,
      distinctStudents: slot.acc.students.size,
    }));

    const marks: NewMarksRollup[] = [...marksAcc.values()].map((slot) => ({
      scopeLevel: slot.key.level as Exclude<ScopeLevel, "section">,
      nodeId: slot.key.nodeId,
      collegeId: slot.key.collegeId,
      ...(slot.key.departmentId !== undefined ? { departmentId: slot.key.departmentId } : {}),
      ...(slot.key.classId !== undefined ? { classId: slot.key.classId } : {}),
      academicYear,
      period: slot.period,
      subjectId: slot.subjectId,
      subjects: [...slot.acc.subjects].sort(),
      avgPct: round1(slot.acc.sumPct / Math.max(1, slot.acc.n)),
      nMarks: slot.acc.n,
      distinctStudents: slot.acc.students.size,
    }));

    const flags: NewStudentFlag[] = [];
    for (const [studentId, acc] of students) {
      // Current live position wins over record positions (transfers).
      const current = await this.deps.directory.studentPosition(studentId);
      const position = current ?? acc.position;
      const attendancePct =
        acc.attendanceTotal === 0 ? null : round1((acc.attended / acc.attendanceTotal) * 100);
      const subjectPcts: Record<string, number> = {};
      let overallSum = 0;
      let overallN = 0;
      for (const [subjectId, sums] of acc.subjectSums) {
        subjectPcts[subjectId] = round1(sums.sum / sums.n);
        overallSum += sums.sum;
        overallN += sums.n;
      }
      const overallPct = overallN === 0 ? null : round1(overallSum / overallN);
      const reasons: string[] = [];
      if (attendancePct !== null && attendancePct < this.deps.thresholds.attendanceThreshold) {
        reasons.push("low-attendance");
      }
      if (overallPct !== null && overallPct < this.deps.thresholds.marksThreshold) {
        reasons.push("low-marks");
      }
      flags.push({
        studentId,
        academicYear,
        collegeId: position.collegeId,
        ...(position.departmentId !== undefined ? { departmentId: position.departmentId } : {}),
        ...(position.classId !== undefined ? { classId: position.classId } : {}),
        ...(position.sectionId !== undefined ? { sectionId: position.sectionId } : {}),
        attendancePct,
        overallPct,
        subjectPcts,
        reasons,
      });
    }

    await this.deps.repo.replaceYear(academicYear, { attendance, marks, flags });
    await this.deps.audit.record({
      module: "analytics",
      action: "analytics.rollups-rebuilt",
      actorType: "system",
      actorId: null,
      resourceType: "rollup",
      resourceId: null,
      requestId: null,
      details: {
        academicYear,
        attendanceRows,
        markRows,
        attendanceRollups: attendance.length,
        marksRollups: marks.length,
        flags: flags.length,
        flagged: flags.filter((flag) => flag.reasons.length > 0).length,
      },
    });
    log.info(
      { academicYear, attendanceRows, markRows, rollups: attendance.length + marks.length, flags: flags.length },
      "rollup rebuild finished",
    );
    return { attendanceRollups: attendance.length, marksRollups: marks.length, flags: flags.length };
  }
}
