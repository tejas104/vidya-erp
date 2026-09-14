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
import { schoolAcademicsModuleDefinition } from "./definition";
import { createSchoolAcademicsHandlers } from "./handlers";
import { createTermsRepo } from "./repo";
import { createAssessmentTypesRepo } from "./assessment-types-repo";
import { createAssessmentTypesHandlers } from "./assessment-types-handlers";
import { createSchoolMarksRepo } from "./marks-repo";
import { createSchoolMarksHandlers } from "./marks-handlers";
import type { SchoolGradeScales } from "./marks-contracts";

export {
  MODULE_NAME as SCHOOL_ACADEMICS_MODULE_NAME,
  schoolAcademicsModuleDefinition,
} from "./definition";

export interface SchoolAcademicsModuleDeps {
  readonly db: Db;
  readonly peopleDirectory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
  readonly gradeScales: SchoolGradeScales;
}

export function createSchoolAcademicsModule(
  deps: SchoolAcademicsModuleDeps,
): RuntimeModule<Record<string, never>> {
  const repo = createTermsRepo(deps.db);
  const types = createAssessmentTypesRepo(deps.db);
  const module: RuntimeModule<Record<string, never>> = {
    definition: schoolAcademicsModuleDefinition,
    handlers: { ...createSchoolAcademicsHandlers({
      repo,
      directory: deps.peopleDirectory,
      scopeChecker: deps.scopeChecker,
    }), ...createAssessmentTypesHandlers({ terms: repo, types, scopeChecker: deps.scopeChecker }),
    ...createSchoolMarksHandlers({ repo: createSchoolMarksRepo(deps.db), terms: repo, types, directory: deps.peopleDirectory, gradeScales: deps.gradeScales, scopeChecker: deps.scopeChecker }) },
    jobProcessors: {},
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
