/**
 * @vidya/module-school-academics — PUBLIC API (the only importable surface).
 *
 * The academic TERM entity, school edition only. Assignment #14's foundation
 * slice, plus term-specific assessment types and percentage weightings.
 *
 * Terms open on creation and can be closed; reopening a closed term requires
 * a non-empty reason and is audited. No jobs.
 */

import {
  assertModuleWiring,
  type Db,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { AcademicsReadModel } from "@vidya/module-academics";
import { schoolAcademicsModuleDefinition } from "./definition";
import { createSchoolAcademicsHandlers } from "./handlers";
import { createTermsRepo } from "./repo";
import { createAssessmentTypesRepo } from "./assessment-types-repo";
import { createAssessmentTypesHandlers } from "./assessment-types-handlers";
import { createSchoolMarksRepo } from "./marks-repo";
import { createSchoolMarksHandlers } from "./marks-handlers";
import type { SchoolGradeScales } from "./marks-contracts";
import { createAttendanceReviewHandlers, createAttendanceReviewSource, type AttendanceReviewSource } from "./attendance-review-handlers";
import {
  createSchoolAcademicsReadModel,
  type SchoolAcademicsReadModel,
} from "./report-source";

export {
  MODULE_NAME as SCHOOL_ACADEMICS_MODULE_NAME,
  schoolAcademicsModuleDefinition,
} from "./definition";

// The S01 weighted-result engine, published as this module's calculation
// contract. Other modules (reporting's report cards) MUST consume this rather
// than re-implementing the arithmetic or reading `sca_` tables — gate-04's
// standing instruction. The engine itself stays pure and storage-free.
export {
  calculateWeightedResult,
  ENGINE_VERSION as SCHOOL_RESULT_ENGINE_VERSION,
  POLICY_VERSION as SCHOOL_RESULT_POLICY_VERSION,
} from "./aggregation";
export type {
  AssessmentDefinition,
  AssessmentEntry,
  AssessmentEntryStatus,
  AssessmentTypeWeight,
  CalculationOutcome,
  CalculationPolicy,
  CalculationResult,
  TypeContribution,
  WithinTypeAggregation,
} from "./aggregation";

// The read model that supplies trusted source facts for that engine.
export {
  DEFAULT_WITHIN_TYPE_AGGREGATION,
  schoolCalculationPolicy,
} from "./report-source";
export type { AttendanceReviewSource, AttendanceReviewSourceResult } from "./attendance-review-handlers";
export type {
  SchoolAcademicsReadModel,
  SchoolSubjectSource,
  SchoolTermRecord,
  SchoolTermResultSource,
} from "./report-source";

export interface SchoolAcademicsModuleDeps {
  readonly db: Db;
  readonly peopleDirectory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
  readonly gradeScales: SchoolGradeScales;
  readonly academicsReadModel: AcademicsReadModel;
}

/** The school-academics public service: the term-result read model that the
 *  reporting module builds report cards from (S01 integration seam). */
export interface SchoolAcademicsService {
  readonly readModel: SchoolAcademicsReadModel;
  readonly attendanceReview: AttendanceReviewSource;
}

export function createSchoolAcademicsModule(
  deps: SchoolAcademicsModuleDeps,
): RuntimeModule<SchoolAcademicsService> {
  const repo = createTermsRepo(deps.db);
  const types = createAssessmentTypesRepo(deps.db);
  const attendanceDeps = { terms: repo, directory: deps.peopleDirectory, scopeChecker: deps.scopeChecker, academics: deps.academicsReadModel };
  const attendanceReview = createAttendanceReviewSource(attendanceDeps);
  const module: RuntimeModule<SchoolAcademicsService> = {
    definition: schoolAcademicsModuleDefinition,
    handlers: { ...createSchoolAcademicsHandlers({
      repo,
      directory: deps.peopleDirectory,
      scopeChecker: deps.scopeChecker,
    }), ...createAssessmentTypesHandlers({ terms: repo, types, scopeChecker: deps.scopeChecker }),
    ...createSchoolMarksHandlers({ repo: createSchoolMarksRepo(deps.db), terms: repo, types, directory: deps.peopleDirectory, gradeScales: deps.gradeScales, scopeChecker: deps.scopeChecker }),
    ...createAttendanceReviewHandlers(attendanceDeps, attendanceReview) },
    jobProcessors: {},
    readinessChecks: [],
    service: { readModel: createSchoolAcademicsReadModel(deps.db), attendanceReview },
  };
  assertModuleWiring(module);
  return module;
}
