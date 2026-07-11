import type { Principal } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { QueryService } from "./query-service";
import type { ScopeLevel } from "../repo/rollups-repo";
import type { AggState, AttendanceSummary, MarksSummary } from "./query-service";

/**
 * The analytics PUBLIC read model (#6). Every method routes through the
 * QueryService — the tested disclosure surface of ADR-0018 — so a REPORT
 * built from this data inherits constituent-closure, the minimum-cohort
 * rule and at-risk field-gating exactly as a live view. A report literally
 * cannot contain more than the caller's dashboard would, by construction.
 */

export interface StudentPerformanceReport {
  readonly state: "ok";
  readonly studentId: string;
  readonly name: string;
  readonly attendance: { pct: number; total: number; monthly: { month: string; pct: number }[] } | null;
  readonly subjects: { subjectId: string; name: string; avgPct: number; series: { label: string; pct: number }[] }[];
  readonly overallPct: number | null;
}

export interface NodeRollupsReport {
  readonly level: ScopeLevel;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly attendance: AggState<AttendanceSummary> | { state: "denied" };
  readonly marks: {
    readonly bySubject: { subjectId: string; name: string; summary: AggState<MarksSummary> }[];
    readonly overall: AggState<MarksSummary> | { state: "denied"; deniedSubjectId?: string };
  };
}

export interface AtRiskReportEntry {
  readonly studentId: string;
  readonly name: string;
  readonly attendancePct: number | null;
  readonly subjectPcts: Record<string, number>;
  readonly overallPct: number | null;
  readonly reasons: string[];
}

export interface RosterAttendanceReport {
  readonly sectionId: string;
  readonly sectionName: string;
  readonly rows: { studentId: string; name: string; pct: number; total: number }[];
}

export interface AnalyticsReadModel {
  studentPerformance(
    principal: Principal,
    studentId: string,
    academicYear: string,
  ): Promise<StudentPerformanceReport | { state: "denied" } | { state: "not-found" }>;
  nodeRollups(
    principal: Principal,
    level: ScopeLevel,
    nodeId: string,
    academicYear: string,
  ): Promise<NodeRollupsReport | null>;
  atRisk(
    principal: Principal,
    level: ScopeLevel,
    nodeId: string,
    academicYear: string,
  ): Promise<AtRiskReportEntry[] | null>;
  rosterAttendance(
    principal: Principal,
    sectionId: string,
    academicYear: string,
  ): Promise<RosterAttendanceReport | null>;
}

export function createAnalyticsReadModel(
  query: QueryService,
  directory: PeopleDirectory,
): AnalyticsReadModel {
  return {
    async studentPerformance(principal, studentId, academicYear) {
      const result = await query.studentPerformance(principal, studentId, academicYear);
      if (result.state !== "ok") {
        return result;
      }
      const names = await directory.namesFor([
        studentId,
        ...result.subjects.map((subject) => subject.subjectId),
      ]);
      return {
        state: "ok",
        studentId,
        name: names.get(studentId) ?? studentId,
        attendance: result.attendance,
        subjects: result.subjects.map((subject) => ({
          ...subject,
          name: names.get(subject.subjectId) ?? subject.subjectId,
        })),
        overallPct: result.overallPct,
      };
    },

    async nodeRollups(principal, level, nodeId, academicYear) {
      const node = await query.nodePath(level, nodeId);
      if (node === null) {
        return null;
      }
      const attendance = await query.nodeAttendance(principal, nodeId, node, academicYear);
      const marks = await query.nodeMarks(principal, nodeId, node, academicYear);
      const names = await directory.namesFor([nodeId, ...marks.bySubject.map((row) => row.subjectId)]);
      return {
        level,
        nodeId,
        nodeName: names.get(nodeId) ?? nodeId,
        attendance,
        marks: {
          bySubject: marks.bySubject.map((row) => ({
            subjectId: row.subjectId,
            name: names.get(row.subjectId) ?? row.subjectId,
            summary: row.summary,
          })),
          overall: marks.overall,
        },
      };
    },

    async atRisk(principal, level, nodeId, academicYear) {
      if ((await query.nodePath(level, nodeId)) === null) {
        return null;
      }
      return query.atRisk(principal, level, nodeId, academicYear);
    },

    async rosterAttendance(principal, sectionId, academicYear) {
      const node = await query.nodePath("section", sectionId);
      if (node === null) {
        return null;
      }
      const roster = await directory.sectionRoster(sectionId);
      const names = await directory.namesFor([sectionId, ...roster.map((entry) => entry.studentId)]);
      const rows: { studentId: string; name: string; pct: number; total: number }[] = [];
      for (const entry of roster) {
        // Each student's attendance is computed per-record-filtered; a
        // student with no attendance the caller can read is omitted.
        const perf = await query.studentPerformance(principal, entry.studentId, academicYear);
        if (perf.state === "ok" && perf.attendance !== null) {
          rows.push({
            studentId: entry.studentId,
            name: names.get(entry.studentId) ?? entry.studentId,
            pct: perf.attendance.pct,
            total: perf.attendance.total,
          });
        }
      }
      return {
        sectionId,
        sectionName: names.get(sectionId) ?? sectionId,
        rows: rows.sort((a, b) => a.pct - b.pct),
      };
    },
  };
}
