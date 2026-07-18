/**
 * @vidya/module-academics — PUBLIC API (the only importable surface).
 *
 * Attendance and marks against the #3 org tree: every read and write flows
 * through #2's ScopeChecker via the resource-ref builders (one page,
 * src/resource-refs.ts). Attendance rows are non-subject records; marks
 * always carry their assessment's subjectId — the matrix's load-bearing
 * distinction (ADR-0017). Grade changes are fully audited with
 * before/after diffs.
 */

import { Counter } from "prom-client";
import {
  assertModuleWiring,
  type AuditLogger,
  type Db,
  type Metrics,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import {
  GAP_SCAN_JOB_NAME,
  academicsModuleDefinition,
} from "./definition";
import { createAttendanceRepo } from "./repo/attendance-repo";
import { createMarksRepo } from "./repo/marks-repo";
import { AttendanceService } from "./service/attendance-service";
import { MarksService } from "./service/marks-service";
import { createAcademicsHandlers, type AuditHistoryEntry } from "./api/handlers";
import { createGapScanProcessor } from "./jobs/attendance-gap-scan";
import type { AssessmentPosition, AttendancePosition } from "./resource-refs";

export {
  GAP_SCAN_JOB_NAME,
  GAP_SCAN_SCHEDULER_ID,
  MODULE_NAME as ACADEMICS_MODULE_NAME,
  academicsModuleDefinition,
} from "./definition";
export { attendanceRef, marksRef } from "./resource-refs";
export type { AttendancePosition, AssessmentPosition } from "./resource-refs";
export type { AuditHistoryEntry } from "./api/handlers";

// ---------------------------------------------------------------------------
// Read model (#5): position-carrying record views for the analytics module.
// Every view includes the record's stored org path (+ subjectId for marks)
// so the consumer can run the ScopeChecker per record BEFORE aggregating —
// the filter-at-source rule of ADR-0018.
// ---------------------------------------------------------------------------

export interface AttendanceRecordView {
  readonly entryId: string;
  readonly studentId: string;
  readonly status: "present" | "absent" | "late" | "excused";
  readonly heldOn: string;
  readonly academicYear: string;
  readonly position: AttendancePosition;
}

export interface MarkRecordView {
  readonly markId: string;
  readonly studentId: string;
  /** Score normalized to percent of the assessment's maxScore. */
  readonly scorePct: number;
  readonly kind: string;
  readonly assessmentName: string;
  readonly heldOn: string | null;
  readonly recordedAt: string;
  readonly academicYear: string;
  readonly position: AssessmentPosition;
}

export interface AcademicsReadModel {
  /** Keyset page over a year's attendance entries (nightly rollup build). */
  attendancePage(
    academicYear: string,
    afterEntryId: string | null,
    limit: number,
  ): Promise<{ rows: AttendanceRecordView[]; nextAfter: string | null }>;
  /** Keyset page over a year's marks (nightly rollup build). */
  marksPage(
    academicYear: string,
    afterMarkId: string | null,
    limit: number,
  ): Promise<{ rows: MarkRecordView[]; nextAfter: string | null }>;
  /** One student's records, for live (per-record-filtered) views. */
  studentAttendance(studentId: string, academicYear?: string): Promise<AttendanceRecordView[]>;
  studentMarks(studentId: string, academicYear?: string): Promise<MarkRecordView[]>;
  /** A section's most recent sessions with present-%, newest first (register strip). */
  sectionRecentDensity(
    sectionId: string,
    limit: number,
  ): Promise<{ heldOn: string; slot: string; presentPct: number; students: number }[]>;
}

export interface AcademicsModuleDeps {
  readonly db: Db;
  readonly metrics: Metrics;
  /** The audit seam (system module's implementation). */
  readonly audit: AuditLogger;
  /** #2's scope-check chokepoint — every handler decision goes through it. */
  readonly scopeChecker: ScopeChecker;
  /** #3's read-only directory: org paths, rosters, existence checks. */
  readonly peopleDirectory: PeopleDirectory;
  /** System module's audit read-back — powers the mark-history endpoint. */
  readonly readAudit: (
    resourceType: string,
    resourceId: string,
    limit: number,
  ) => Promise<AuditHistoryEntry[]>;
  /** System module's action-filtered audit read-back — powers the section-corrections queue. */
  readonly readAuditByAction: (action: string, limit: number) => Promise<AuditHistoryEntry[]>;
}

/** The academics public service: the read model consumed by analytics (#5). */
export interface AcademicsService {
  readonly readModel: AcademicsReadModel;
}

export function createAcademicsModule(
  deps: AcademicsModuleDeps,
): RuntimeModule<AcademicsService> {
  const attendanceRepo = createAttendanceRepo(deps.db);
  const marksRepo = createMarksRepo(deps.db);
  const gapsTotal = new Counter({
    name: "vidya_attendance_gaps_total",
    help: "Sections found without an attendance session by the daily gap scan",
    registers: [deps.metrics.registry],
  });
  const attendance = new AttendanceService({
    repo: attendanceRepo,
    directory: deps.peopleDirectory,
    audit: deps.audit,
    onGaps: (count) => gapsTotal.inc(count),
  });
  const marks = new MarksService({ repo: marksRepo, directory: deps.peopleDirectory });

  const module: RuntimeModule<AcademicsService> = {
    definition: academicsModuleDefinition,
    handlers: createAcademicsHandlers({
      attendance,
      marks,
      scopeChecker: deps.scopeChecker,
      peopleDirectory: deps.peopleDirectory,
      readAudit: deps.readAudit,
      readAuditByAction: deps.readAuditByAction,
    }),
    jobProcessors: {
      [GAP_SCAN_JOB_NAME]: createGapScanProcessor(attendance),
    },
    readinessChecks: [],
    service: {
      readModel: {
        async attendancePage(academicYear, afterEntryId, limit) {
          const rows = await attendanceRepo.pageEntries(academicYear, afterEntryId, limit);
          const views = rows.map(({ session, entry }) => ({
            entryId: entry.id,
            studentId: entry.studentId,
            status: entry.status as AttendanceRecordView["status"],
            heldOn: session.heldOn,
            academicYear: session.academicYear,
            position: {
              collegeId: session.collegeId,
              departmentId: session.departmentId,
              classId: session.classId,
              sectionId: session.sectionId,
            },
          }));
          return {
            rows: views,
            nextAfter: views.length === limit ? (views[views.length - 1]?.entryId ?? null) : null,
          };
        },
        async marksPage(academicYear, afterMarkId, limit) {
          const rows = await marksRepo.pageMarks(academicYear, afterMarkId, limit);
          const views = rows.map(({ mark, assessment }) => toMarkView(mark, assessment));
          return {
            rows: views,
            nextAfter: views.length === limit ? (views[views.length - 1]?.markId ?? null) : null,
          };
        },
        async studentAttendance(studentId, academicYear) {
          const rows = await attendanceRepo.sessionsForStudent(studentId, academicYear);
          return rows.map(({ session, entry }) => ({
            entryId: entry.id,
            studentId: entry.studentId,
            status: entry.status as AttendanceRecordView["status"],
            heldOn: session.heldOn,
            academicYear: session.academicYear,
            position: {
              collegeId: session.collegeId,
              departmentId: session.departmentId,
              classId: session.classId,
              sectionId: session.sectionId,
            },
          }));
        },
        async studentMarks(studentId, academicYear) {
          const rows = await marksRepo.marksForStudent(studentId, {
            ...(academicYear !== undefined ? { academicYear } : {}),
          });
          return rows.map(({ mark, assessment }) => toMarkView(mark, assessment));
        },
        sectionRecentDensity: (sectionId, limit) =>
          attendanceRepo.recentSessionDensity(sectionId, limit),
      },
    },
  };
  assertModuleWiring(module);
  return module;
}

function toMarkView(
  mark: { id: string; studentId: string; score: string; updatedAt: Date },
  assessment: {
    id: string;
    kind: string;
    name: string;
    heldOn: string | null;
    academicYear: string;
    maxScore: string;
    collegeId: string;
    departmentId: string;
    classId: string;
    subjectId: string;
  },
): MarkRecordView {
  const max = Number(assessment.maxScore);
  return {
    markId: mark.id,
    studentId: mark.studentId,
    scorePct: max === 0 ? 0 : Math.round((Number(mark.score) / max) * 1000) / 10,
    kind: assessment.kind,
    assessmentName: assessment.name,
    heldOn: assessment.heldOn,
    recordedAt: mark.updatedAt.toISOString(),
    academicYear: assessment.academicYear,
    position: {
      collegeId: assessment.collegeId,
      departmentId: assessment.departmentId,
      classId: assessment.classId,
      subjectId: assessment.subjectId,
    },
  };
}
