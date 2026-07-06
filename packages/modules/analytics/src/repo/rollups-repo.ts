import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import {
  anlAttendanceRollups,
  anlMarksRollups,
  anlStudentFlags,
  type AnlAttendanceRollupRow,
  type AnlMarksRollupRow,
  type AnlStudentFlagRow,
} from "../db/schema";

export type ScopeLevel = "section" | "class" | "department" | "college";

export interface NewAttendanceRollup {
  readonly scopeLevel: ScopeLevel;
  readonly nodeId: string;
  readonly collegeId: string;
  readonly departmentId?: string;
  readonly classId?: string;
  readonly sectionId?: string;
  readonly academicYear: string;
  readonly period: string;
  readonly sessions: number;
  readonly present: number;
  readonly absent: number;
  readonly late: number;
  readonly excused: number;
  readonly distinctStudents: number;
}

export interface NewMarksRollup {
  readonly scopeLevel: Exclude<ScopeLevel, "section">;
  readonly nodeId: string;
  readonly collegeId: string;
  readonly departmentId?: string;
  readonly classId?: string;
  readonly academicYear: string;
  readonly period: string;
  readonly subjectId: string | null;
  readonly subjects: readonly string[];
  readonly avgPct: number;
  readonly nMarks: number;
  readonly distinctStudents: number;
}

export interface NewStudentFlag {
  readonly studentId: string;
  readonly academicYear: string;
  readonly collegeId: string;
  readonly departmentId?: string;
  readonly classId?: string;
  readonly sectionId?: string;
  readonly attendancePct: number | null;
  readonly overallPct: number | null;
  readonly subjectPcts: Readonly<Record<string, number>>;
  readonly reasons: readonly string[];
}

export interface RollupsRepo {
  /** Atomic replace of a year's derived data (idempotent rebuild). */
  replaceYear(
    academicYear: string,
    data: {
      attendance: readonly NewAttendanceRollup[];
      marks: readonly NewMarksRollup[];
      flags: readonly NewStudentFlag[];
    },
  ): Promise<void>;
  attendanceForNode(nodeId: string, academicYear: string): Promise<AnlAttendanceRollupRow[]>;
  marksForNode(nodeId: string, academicYear: string): Promise<AnlMarksRollupRow[]>;
  flagsForClass(classId: string, academicYear: string): Promise<AnlStudentFlagRow[]>;
  flagsUnder(
    level: ScopeLevel,
    nodeId: string,
    academicYear: string,
  ): Promise<AnlStudentFlagRow[]>;
  flagForStudent(studentId: string, academicYear: string): Promise<AnlStudentFlagRow | null>;
}

const CHUNK = 500;

export function createRollupsRepo(db: Db): RollupsRepo {
  return {
    async replaceYear(academicYear, data) {
      await db.transaction(async (tx) => {
        await tx.delete(anlAttendanceRollups).where(eq(anlAttendanceRollups.academicYear, academicYear));
        await tx.delete(anlMarksRollups).where(eq(anlMarksRollups.academicYear, academicYear));
        await tx.delete(anlStudentFlags).where(eq(anlStudentFlags.academicYear, academicYear));
        for (let index = 0; index < data.attendance.length; index += CHUNK) {
          await tx.insert(anlAttendanceRollups).values(
            data.attendance.slice(index, index + CHUNK).map((row) => ({
              id: `aar_${randomUUID()}`,
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
            })),
          );
        }
        for (let index = 0; index < data.marks.length; index += CHUNK) {
          await tx.insert(anlMarksRollups).values(
            data.marks.slice(index, index + CHUNK).map((row) => ({
              id: `amr_${randomUUID()}`,
              scopeLevel: row.scopeLevel,
              nodeId: row.nodeId,
              collegeId: row.collegeId,
              departmentId: row.departmentId ?? null,
              classId: row.classId ?? null,
              academicYear: row.academicYear,
              period: row.period,
              subjectId: row.subjectId,
              subjects: row.subjects,
              avgPct: row.avgPct.toFixed(2),
              nMarks: row.nMarks,
              distinctStudents: row.distinctStudents,
            })),
          );
        }
        for (let index = 0; index < data.flags.length; index += CHUNK) {
          await tx.insert(anlStudentFlags).values(
            data.flags.slice(index, index + CHUNK).map((row) => ({
              id: `afl_${randomUUID()}`,
              studentId: row.studentId,
              academicYear: row.academicYear,
              collegeId: row.collegeId,
              departmentId: row.departmentId ?? null,
              classId: row.classId ?? null,
              sectionId: row.sectionId ?? null,
              attendancePct: row.attendancePct === null ? null : row.attendancePct.toFixed(2),
              overallPct: row.overallPct === null ? null : row.overallPct.toFixed(2),
              subjectPcts: row.subjectPcts,
              reasons: row.reasons,
            })),
          );
        }
      });
    },

    async attendanceForNode(nodeId, academicYear) {
      return db
        .select()
        .from(anlAttendanceRollups)
        .where(
          and(
            eq(anlAttendanceRollups.nodeId, nodeId),
            eq(anlAttendanceRollups.academicYear, academicYear),
          ),
        );
    },

    async marksForNode(nodeId, academicYear) {
      return db
        .select()
        .from(anlMarksRollups)
        .where(
          and(eq(anlMarksRollups.nodeId, nodeId), eq(anlMarksRollups.academicYear, academicYear)),
        );
    },

    async flagsForClass(classId, academicYear) {
      return db
        .select()
        .from(anlStudentFlags)
        .where(
          and(eq(anlStudentFlags.classId, classId), eq(anlStudentFlags.academicYear, academicYear)),
        );
    },

    async flagsUnder(level, nodeId, academicYear) {
      const yearCondition = eq(anlStudentFlags.academicYear, academicYear);
      switch (level) {
        case "section":
          return db
            .select()
            .from(anlStudentFlags)
            .where(and(yearCondition, eq(anlStudentFlags.sectionId, nodeId)));
        case "class":
          return db
            .select()
            .from(anlStudentFlags)
            .where(and(yearCondition, eq(anlStudentFlags.classId, nodeId)));
        case "department":
          return db
            .select()
            .from(anlStudentFlags)
            .where(and(yearCondition, eq(anlStudentFlags.departmentId, nodeId)));
        case "college":
          return db
            .select()
            .from(anlStudentFlags)
            .where(and(yearCondition, eq(anlStudentFlags.collegeId, nodeId)));
      }
    },

    async flagForStudent(studentId, academicYear) {
      const rows = await db
        .select()
        .from(anlStudentFlags)
        .where(
          and(
            eq(anlStudentFlags.studentId, studentId),
            eq(anlStudentFlags.academicYear, academicYear),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
