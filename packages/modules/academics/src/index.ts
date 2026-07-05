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

export {
  GAP_SCAN_JOB_NAME,
  GAP_SCAN_SCHEDULER_ID,
  MODULE_NAME as ACADEMICS_MODULE_NAME,
  academicsModuleDefinition,
} from "./definition";
export { attendanceRef, marksRef } from "./resource-refs";
export type { AttendancePosition, AssessmentPosition } from "./resource-refs";
export type { AuditHistoryEntry } from "./api/handlers";

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
}

/**
 * The academics module exposes no cross-module service yet — attendance
 * and marks are consumed via the versioned HTTP API; report cards and
 * analytics (later tiers) will get a read-model service when they exist.
 */
export type AcademicsService = Record<string, never>;

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
      readAudit: deps.readAudit,
    }),
    jobProcessors: {
      [GAP_SCAN_JOB_NAME]: createGapScanProcessor(attendance),
    },
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
