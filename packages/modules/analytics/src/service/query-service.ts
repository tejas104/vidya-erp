import type { OrgPath, Principal, ScopeChecker } from "@vidya/platform";
import { attendanceRef, marksRef, type AcademicsReadModel } from "@vidya/module-academics";
import type { PeopleDirectory } from "@vidya/module-people";
import {
  canReadAttendanceAgg,
  canReadCrossSubjectAgg,
  canReadMarksAgg,
  cohortSufficient,
} from "../aggregation-scope";
import type { RollupsRepo, ScopeLevel } from "../repo/rollups-repo";
import type { AnlAttendanceRollupRow, AnlMarksRollupRow, AnlStudentFlagRow } from "../db/schema";

const YTD = "YTD";

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

export interface QueryServiceDeps {
  readonly repo: RollupsRepo;
  readonly academicsRead: AcademicsReadModel;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
  readonly minCohort: number;
}

/** An aggregate slot as served: real value, or an explicit designed state. */
export type AggState<T> =
  | { state: "ok"; value: T }
  | { state: "insufficient-cohort"; minCohort: number }
  | { state: "no-data" };

export interface AttendanceSummary {
  readonly pct: number;
  readonly sessions: number;
  readonly distinctStudents: number;
  readonly monthly: readonly { month: string; pct: number }[];
}

export interface MarksSummary {
  readonly avgPct: number;
  readonly nMarks: number;
  readonly distinctStudents: number;
  readonly monthly: readonly { month: string; avgPct: number }[];
}

function attendancePct(row: { present: number; absent: number; late: number; excused: number }): number {
  const total = row.present + row.absent + row.late + row.excused;
  return total === 0 ? 0 : Math.round(((row.present + row.late) / total) * 1000) / 10;
}

function nodePathOf(row: {
  collegeId: string;
  departmentId: string | null;
  classId?: string | null;
  sectionId?: string | null;
}): OrgPath {
  return {
    collegeId: row.collegeId,
    ...(row.departmentId != null ? { departmentId: row.departmentId } : {}),
    ...(row.classId != null ? { classId: row.classId } : {}),
    ...(row.sectionId != null ? { sectionId: row.sectionId } : {}),
  };
}

/**
 * The serving layer of ADR-0018. Every method takes the caller's Principal
 * and returns only what constituent-closure + the unconditional
 * minimum-cohort rule allow — precomputed rows are inputs, never answers.
 */
export class QueryService {
  constructor(private readonly deps: QueryServiceDeps) {}

  async nodePath(level: ScopeLevel, nodeId: string): Promise<OrgPath | null> {
    switch (level) {
      case "section":
        return this.deps.directory.sectionPath(nodeId);
      case "class":
        return this.deps.directory.classPath(nodeId);
      case "department":
        return this.deps.directory.departmentPath(nodeId);
      case "college":
        return (await this.deps.directory.collegeExists(nodeId)) ? { collegeId: nodeId } : null;
    }
  }

  /** Attendance rollup for a node — one closure check (constituents share the ref). */
  attendanceSummary(
    principal: Principal,
    node: OrgPath,
    rows: AnlAttendanceRollupRow[],
  ): AggState<AttendanceSummary> | { state: "denied" } {
    if (!canReadAttendanceAgg(this.deps.scopeChecker, principal, node)) {
      return { state: "denied" };
    }
    const ytd = rows.find((row) => row.period === YTD);
    if (ytd === undefined || ytd.sessions === 0) {
      return { state: "no-data" };
    }
    if (!cohortSufficient(ytd.distinctStudents, this.deps.minCohort)) {
      return { state: "insufficient-cohort", minCohort: this.deps.minCohort };
    }
    const monthly = rows
      .filter((row) => row.period !== YTD)
      .filter((row) => cohortSufficient(row.distinctStudents, this.deps.minCohort))
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((row) => ({ month: row.period, pct: attendancePct(row) }));
    return {
      state: "ok",
      value: {
        pct: attendancePct(ytd),
        sessions: ytd.sessions,
        distinctStudents: ytd.distinctStudents,
        monthly,
      },
    };
  }

  /** Per-subject marks rollups a caller may see, plus the cross-subject row under closure. */
  marksSummaries(
    principal: Principal,
    node: OrgPath,
    rows: AnlMarksRollupRow[],
  ): {
    bySubject: { subjectId: string; summary: AggState<MarksSummary> }[];
    overall: AggState<MarksSummary> | { state: "denied"; deniedSubjectId?: string };
  } {
    const ytdRows = rows.filter((row) => row.period === YTD);
    const bySubject: { subjectId: string; summary: AggState<MarksSummary> }[] = [];
    for (const row of ytdRows) {
      if (row.subjectId === null) {
        continue;
      }
      if (!canReadMarksAgg(this.deps.scopeChecker, principal, node, row.subjectId)) {
        continue; // row-filtered: absent, not "denied" — the caller never learns it exists
      }
      bySubject.push({ subjectId: row.subjectId, summary: this.marksState(row, rows) });
    }

    const cross = ytdRows.find((row) => row.subjectId === null);
    if (cross === undefined) {
      return { bySubject, overall: { state: "no-data" } };
    }
    const closure = canReadCrossSubjectAgg(
      this.deps.scopeChecker,
      principal,
      node,
      cross.subjects as string[],
    );
    if (!closure.granted) {
      // A denial from a non-empty constituent list always names the subject.
      return {
        bySubject,
        overall: { state: "denied", deniedSubjectId: closure.deniedSubjectId },
      };
    }
    if (!cohortSufficient(cross.distinctStudents, this.deps.minCohort)) {
      return { bySubject, overall: { state: "insufficient-cohort", minCohort: this.deps.minCohort } };
    }
    return {
      bySubject,
      overall: {
        state: "ok",
        value: this.toMarksSummary(cross, rows, null),
      },
    };
  }

  /** `ytd` is always a real per-subject YTD row (nMarks ≥ 1 by construction). */
  private marksState(ytd: AnlMarksRollupRow, rows: AnlMarksRollupRow[]): AggState<MarksSummary> {
    if (!cohortSufficient(ytd.distinctStudents, this.deps.minCohort)) {
      return { state: "insufficient-cohort", minCohort: this.deps.minCohort };
    }
    return { state: "ok", value: this.toMarksSummary(ytd, rows, ytd.subjectId) };
  }

  private toMarksSummary(
    ytd: AnlMarksRollupRow,
    rows: AnlMarksRollupRow[],
    subjectId: string | null,
  ): MarksSummary {
    const monthly = rows
      .filter((row) => row.period !== YTD && row.subjectId === subjectId)
      .filter((row) => cohortSufficient(row.distinctStudents, this.deps.minCohort))
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((row) => ({ month: row.period, avgPct: Number(row.avgPct) }));
    return {
      avgPct: Number(ytd.avgPct),
      nMarks: ytd.nMarks,
      distinctStudents: ytd.distinctStudents,
      monthly,
    };
  }

  /**
   * At-risk entries under a node, FIELD-GATED per caller (approved
   * decision 4): the attendance component is visible to anyone covering
   * the student's section; per-subject scores only for that subject's
   * readers; the overall score and the "low-marks" reason only under full
   * cross-subject closure. Entries with no visible flagged reason are
   * omitted entirely.
   */
  async atRisk(
    principal: Principal,
    level: ScopeLevel,
    nodeId: string,
    academicYear: string,
  ): Promise<
    {
      studentId: string;
      name: string;
      attendancePct: number | null;
      subjectPcts: Record<string, number>;
      overallPct: number | null;
      reasons: string[];
    }[]
  > {
    const flags = await this.deps.repo.flagsUnder(level, nodeId, academicYear);
    const results = [];
    for (const flag of flags) {
      if ((flag.reasons as string[]).length === 0) {
        continue;
      }
      const gated = this.gateFlag(principal, flag);
      if (gated !== null && gated.reasons.length > 0) {
        results.push({ studentId: flag.studentId, ...gated });
      }
    }
    const names = await this.deps.directory.namesFor(results.map((row) => row.studentId));
    return results
      .map((row) => ({ ...row, name: names.get(row.studentId) ?? row.studentId }))
      .sort((a, b) => (a.attendancePct ?? 100) - (b.attendancePct ?? 100));
  }

  private gateFlag(
    principal: Principal,
    flag: AnlStudentFlagRow,
  ): {
    name?: string;
    attendancePct: number | null;
    subjectPcts: Record<string, number>;
    overallPct: number | null;
    reasons: string[];
  } | null {
    const position = nodePathOf(flag);
    const reasons = flag.reasons as string[];
    const allSubjects = Object.keys(flag.subjectPcts as Record<string, number>);

    const attendanceVisible =
      flag.attendancePct !== null &&
      canReadAttendanceAgg(this.deps.scopeChecker, principal, position);
    const classNode: OrgPath = {
      collegeId: flag.collegeId,
      ...(flag.departmentId != null ? { departmentId: flag.departmentId } : {}),
      ...(flag.classId != null ? { classId: flag.classId } : {}),
    };
    const visibleSubjects: Record<string, number> = {};
    for (const [subjectId, pct] of Object.entries(flag.subjectPcts as Record<string, number>)) {
      if (canReadMarksAgg(this.deps.scopeChecker, principal, classNode, subjectId)) {
        visibleSubjects[subjectId] = pct;
      }
    }
    const overallVisible =
      flag.overallPct !== null &&
      canReadCrossSubjectAgg(this.deps.scopeChecker, principal, classNode, allSubjects).granted;

    const visibleReasons = reasons.filter((reason) =>
      reason === "low-attendance" ? attendanceVisible : overallVisible,
    );
    if (!attendanceVisible && Object.keys(visibleSubjects).length === 0 && !overallVisible) {
      return null;
    }
    return {
      attendancePct: attendanceVisible ? Number(flag.attendancePct) : null,
      subjectPcts: visibleSubjects,
      overallPct: overallVisible ? Number(flag.overallPct) : null,
      reasons: visibleReasons,
    };
  }

  /**
   * Live per-student view: pulls raw records via #4's read model and runs
   * the checker PER RECORD before any arithmetic (filter-at-source). The
   * overall average is computed only when NO mark was filtered out
   * (closure); otherwise the caller gets exactly their visible subjects.
   */
  async studentPerformance(
    principal: Principal,
    studentId: string,
    academicYear: string,
  ): Promise<
    | { state: "not-found" }
    | { state: "denied" }
    | {
        state: "ok";
        attendance: { pct: number; total: number; monthly: { month: string; pct: number }[] } | null;
        subjects: { subjectId: string; avgPct: number; series: { label: string; pct: number }[] }[];
        overallPct: number | null;
      }
  > {
    if (!(await this.deps.directory.studentsExist([studentId])).has(studentId)) {
      return { state: "not-found" };
    }
    const attendanceRows = (
      await this.deps.academicsRead.studentAttendance(studentId, academicYear)
    ).filter(
      (row) => this.deps.scopeChecker.check(principal, "read", attendanceRef(row.position)).granted,
    );
    const allMarks = await this.deps.academicsRead.studentMarks(studentId, academicYear);
    const visibleMarks = allMarks.filter(
      (row) => this.deps.scopeChecker.check(principal, "read", marksRef(row.position)).granted,
    );
    if (attendanceRows.length === 0 && visibleMarks.length === 0) {
      return { state: "denied" };
    }

    let attendance = null;
    if (attendanceRows.length > 0) {
      const attended = attendanceRows.filter(
        (row) => row.status === "present" || row.status === "late",
      ).length;
      const byMonth = new Map<string, { attended: number; total: number }>();
      for (const row of attendanceRows) {
        const month = row.heldOn.slice(0, 7);
        const slot = byMonth.get(month) ?? { attended: 0, total: 0 };
        slot.total += 1;
        if (row.status === "present" || row.status === "late") {
          slot.attended += 1;
        }
        byMonth.set(month, slot);
      }
      attendance = {
        pct: Math.round((attended / attendanceRows.length) * 1000) / 10,
        total: attendanceRows.length,
        monthly: [...byMonth.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([month, slot]) => ({
            month,
            pct: Math.round((slot.attended / slot.total) * 1000) / 10,
          })),
      };
    }

    const bySubject = new Map<string, { sum: number; n: number; series: { label: string; pct: number }[] }>();
    for (const mark of visibleMarks.sort((a, b) =>
      (a.heldOn ?? a.recordedAt).localeCompare(b.heldOn ?? b.recordedAt),
    )) {
      const slot = bySubject.get(mark.position.subjectId) ?? { sum: 0, n: 0, series: [] };
      slot.sum += mark.scorePct;
      slot.n += 1;
      slot.series.push({ label: mark.assessmentName, pct: mark.scorePct });
      bySubject.set(mark.position.subjectId, slot);
    }
    const subjects = [...bySubject.entries()].map(([subjectId, slot]) => ({
      subjectId,
      avgPct: Math.round((slot.sum / slot.n) * 10) / 10,
      series: slot.series,
    }));

    // Overall only under closure: no record was filtered away.
    const overallPct =
      visibleMarks.length > 0 && visibleMarks.length === allMarks.length
        ? Math.round(
            (visibleMarks.reduce((sum, mark) => sum + mark.scorePct, 0) / visibleMarks.length) * 10,
          ) / 10
        : null;
    return { state: "ok", attendance, subjects, overallPct };
  }

  async nodeAttendance(
    principal: Principal,
    nodeId: string,
    node: OrgPath,
    academicYear: string,
  ): Promise<AggState<AttendanceSummary> | { state: "denied" }> {
    const rows = await this.deps.repo.attendanceForNode(nodeId, academicYear);
    return this.attendanceSummary(principal, node, rows);
  }

  async nodeMarks(
    principal: Principal,
    nodeId: string,
    node: OrgPath,
    academicYear: string,
  ): Promise<ReturnType<QueryService["marksSummaries"]>> {
    const rows = await this.deps.repo.marksForNode(nodeId, academicYear);
    return this.marksSummaries(principal, node, rows);
  }

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

  /**
   * THE PERMISSION MIRROR (approved decision 6): tiles are derived from
   * the caller's grants, so the UI only ever receives what the scope
   * allows — there is nothing to hide client-side. Every number inside a
   * tile is served through the same closure/cohort helpers as the rollup
   * endpoints.
   */
  async dashboard(principal: Principal, academicYear: string) {
    const tiles = [];
    const seen = new Set<string>();
    const nameIds = new Set<string>();

    for (const grant of principal.grants) {
      if (grant.role === "teacher" && grant.org.classId !== undefined && grant.subjectId !== undefined) {
        const key = `teacher|${grant.org.classId}|${grant.subjectId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const classNode = grant.org;
        nameIds.add(grant.org.classId).add(grant.subjectId);
        // The subject tile is served through the same scope-filtered path as
        // any rollup: the teacher's own subject appears in bySubject when
        // data exists, else the designed no-data slot.
        const nodeMarks = await this.nodeMarks(principal, grant.org.classId, classNode, academicYear);
        const subjectEntry = nodeMarks.bySubject.find((row) => row.subjectId === grant.subjectId);
        tiles.push({
          type: "teacher-class" as const,
          classId: grant.org.classId,
          subjectId: grant.subjectId,
          attendance: await this.nodeAttendance(principal, grant.org.classId, classNode, academicYear),
          marks: subjectEntry?.summary ?? { state: "no-data" as const },
          atRisk: (await this.atRisk(principal, "class", grant.org.classId, academicYear)).length,
          strip: await this.classStrip(grant.org.classId),
        });
      } else if (grant.role === "class_teacher" && grant.org.classId !== undefined) {
        const key = `class|${grant.org.classId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        nameIds.add(grant.org.classId);
        tiles.push({
          type: "class" as const,
          classId: grant.org.classId,
          attendance: await this.nodeAttendance(principal, grant.org.classId, grant.org, academicYear),
          marks: (await this.nodeMarks(principal, grant.org.classId, grant.org, academicYear)).overall,
          atRisk: (await this.atRisk(principal, "class", grant.org.classId, academicYear)).length,
          strip: await this.classStrip(grant.org.classId),
        });
      } else if (grant.role === "hod" && grant.org.departmentId !== undefined) {
        const key = `department|${grant.org.departmentId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        nameIds.add(grant.org.departmentId);
        tiles.push({
          type: "department" as const,
          departmentId: grant.org.departmentId,
          attendance: await this.nodeAttendance(principal, grant.org.departmentId, grant.org, academicYear),
          marks: (await this.nodeMarks(principal, grant.org.departmentId, grant.org, academicYear)).overall,
          atRisk: (await this.atRisk(principal, "department", grant.org.departmentId, academicYear)).length,
        });
      } else if (grant.role === "principal" || grant.role === "admin") {
        const key = `college|${grant.org.collegeId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        nameIds.add(grant.org.collegeId);
        tiles.push({
          type: "college" as const,
          collegeId: grant.org.collegeId,
          attendance: await this.nodeAttendance(
            principal,
            grant.org.collegeId,
            { collegeId: grant.org.collegeId },
            academicYear,
          ),
          marks: (
            await this.nodeMarks(
              principal,
              grant.org.collegeId,
              { collegeId: grant.org.collegeId },
              academicYear,
            )
          ).overall,
          atRisk: (await this.atRisk(principal, "college", grant.org.collegeId, academicYear)).length,
        });
      }
    }
    const names = await this.deps.directory.namesFor([...nameIds]);
    return { academicYear, tiles, names: Object.fromEntries(names) };
  }

  /**
   * The register strip: recent per-section session densities (bounded).
   * Each cell is itself an aggregate, so the unconditional minimum-cohort
   * rule applies per cell — small-cohort sessions are omitted.
   */
  private async classStrip(
    classId: string,
  ): Promise<{ sectionId: string; name: string; days: { heldOn: string; presentPct: number }[] }[]> {
    const sections = (await this.deps.directory.sectionsOfClass(classId)).slice(0, 8);
    const strip = [];
    for (const section of sections) {
      const days = (await this.deps.academicsRead.sectionRecentDensity(section.sectionId, 14))
        .filter((day) => cohortSufficient(day.students, this.deps.minCohort))
        .map((day) => ({ heldOn: day.heldOn, presentPct: day.presentPct }))
        .reverse();
      strip.push({ sectionId: section.sectionId, name: section.name, days });
    }
    return strip;
  }

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
}
