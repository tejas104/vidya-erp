/**
 * @vidya/module-school-academics — PUBLIC API (the only importable surface).
 *
 * The academic TERM entity, school edition only. Assignment #14's foundation
 * slice: assessments, marks and report cards are deliberately NOT here.
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

export {
  MODULE_NAME as SCHOOL_ACADEMICS_MODULE_NAME,
  schoolAcademicsModuleDefinition,
} from "./definition";

export interface SchoolAcademicsModuleDeps {
  readonly db: Db;
  readonly peopleDirectory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
}

export function createSchoolAcademicsModule(
  deps: SchoolAcademicsModuleDeps,
): RuntimeModule<Record<string, never>> {
  const module: RuntimeModule<Record<string, never>> = {
    definition: schoolAcademicsModuleDefinition,
    handlers: createSchoolAcademicsHandlers({
      repo: createTermsRepo(deps.db),
      directory: deps.peopleDirectory,
      scopeChecker: deps.scopeChecker,
    }),
    jobProcessors: {},
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
