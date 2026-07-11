/**
 * @vidya/module-timetable — PUBLIC API (the only importable surface).
 *
 * Fixed-period weekly schedules (ttb_): the college's period template plus
 * clash-safe entries per section/teacher/room (uniqueness enforced by the
 * database, surfaced as friendly 409s). Teacher self-scope resolves through
 * the people identity link; the student portal consumes the read model.
 */

import { assertModuleWiring, type AuditLogger, type Db, type RuntimeModule, type ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { timetableModuleDefinition } from "./definition";
import { createTimetableHandlers } from "./handlers";
import { createTimetableRepo } from "./repo";
import { createTimetableReadModel, type TimetableReadModel } from "./read-model";

export { MODULE_NAME as TIMETABLE_MODULE_NAME, timetableModuleDefinition } from "./definition";
export type { TimetableReadModel, TimetableEntryView, TimetablePeriod } from "./read-model";

export interface TimetableModuleDeps {
  readonly db: Db;
  readonly audit: AuditLogger;
  readonly scopeChecker: ScopeChecker;
  readonly peopleDirectory: PeopleDirectory;
}

export interface TimetableService {
  readonly readModel: TimetableReadModel;
}

export function createTimetableModule(deps: TimetableModuleDeps): RuntimeModule<TimetableService> {
  const repo = createTimetableRepo(deps.db);
  const module: RuntimeModule<TimetableService> = {
    definition: timetableModuleDefinition,
    handlers: createTimetableHandlers({
      repo,
      directory: deps.peopleDirectory,
      scopeChecker: deps.scopeChecker,
    }),
    jobProcessors: {},
    readinessChecks: [],
    service: { readModel: createTimetableReadModel(repo, deps.peopleDirectory) },
  };
  assertModuleWiring(module);
  return module;
}
