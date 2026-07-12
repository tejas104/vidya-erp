/**
 * @vidya/module-coursework — PUBLIC API (the only importable surface).
 *
 * Assignments + submissions + study materials (cwk_): the faculty↔student
 * daily content loop. Teacher authority mirrors marks (subject-scoped via
 * the ScopeChecker); student access resolves through the identity link and
 * never accepts a studentId. Files live in object storage (≤1MB, base64
 * over the API — the CSV-import convention).
 */

import {
  assertModuleWiring,
  type AuditLogger,
  type Db,
  type ObjectStorageClient,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { courseworkModuleDefinition } from "./definition";
import { createCourseworkHandlers } from "./handlers";
import { createCourseworkRepo } from "./repo";

export { MODULE_NAME as COURSEWORK_MODULE_NAME, courseworkModuleDefinition } from "./definition";

export interface CourseworkModuleDeps {
  readonly db: Db;
  readonly audit: AuditLogger;
  readonly scopeChecker: ScopeChecker;
  readonly peopleDirectory: PeopleDirectory;
  readonly storage: { readonly client: ObjectStorageClient; readonly bucket: string };
}

export function createCourseworkModule(deps: CourseworkModuleDeps): RuntimeModule<Record<string, never>> {
  const repo = createCourseworkRepo(deps.db);
  const module: RuntimeModule<Record<string, never>> = {
    definition: courseworkModuleDefinition,
    handlers: createCourseworkHandlers({
      repo,
      directory: deps.peopleDirectory,
      scopeChecker: deps.scopeChecker,
      storage: deps.storage,
    }),
    jobProcessors: {},
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
