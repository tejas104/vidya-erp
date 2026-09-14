/**
 * @vidya/module-school-terms — PUBLIC API (the only importable surface).
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
import { schoolTermsModuleDefinition } from "./definition";
import { createSchoolTermsHandlers } from "./handlers";
import { createTermsRepo } from "./repo";

export {
  MODULE_NAME as SCHOOL_TERMS_MODULE_NAME,
  schoolTermsModuleDefinition,
} from "./definition";

export interface SchoolTermsModuleDeps {
  readonly db: Db;
  readonly peopleDirectory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
}

export function createSchoolTermsModule(
  deps: SchoolTermsModuleDeps,
): RuntimeModule<Record<string, never>> {
  const module: RuntimeModule<Record<string, never>> = {
    definition: schoolTermsModuleDefinition,
    handlers: createSchoolTermsHandlers({
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
