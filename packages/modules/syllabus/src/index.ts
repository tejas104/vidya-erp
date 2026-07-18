/**
 * @vidya/module-syllabus — PUBLIC API (the only importable surface).
 *
 * Syllabus units + topics (syl_) with per-topic coverage tracking. Teacher
 * authority mirrors coursework/marks (subject-scoped via the ScopeChecker);
 * student access resolves through the identity link and never accepts a
 * studentId. No object storage — coverage is a date + who-marked-it.
 */

import { assertModuleWiring, type AuditLogger, type Db, type RuntimeModule, type ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { syllabusModuleDefinition } from "./definition";
import { createSyllabusHandlers } from "./handlers";
import { createSyllabusRepo } from "./repo";

export { MODULE_NAME as SYLLABUS_MODULE_NAME, syllabusModuleDefinition } from "./definition";

export interface SyllabusModuleDeps {
  readonly db: Db;
  readonly audit: AuditLogger;
  readonly scopeChecker: ScopeChecker;
  readonly peopleDirectory: PeopleDirectory;
}

export function createSyllabusModule(deps: SyllabusModuleDeps): RuntimeModule<Record<string, never>> {
  const repo = createSyllabusRepo(deps.db);
  const module: RuntimeModule<Record<string, never>> = {
    definition: syllabusModuleDefinition,
    handlers: createSyllabusHandlers({
      repo,
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
