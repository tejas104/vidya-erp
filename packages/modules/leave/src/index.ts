/**
 * @vidya/module-leave — PUBLIC API (the only importable surface).
 *
 * The staff-leave register: teachers apply for leave; their HOD (by the
 * request's department) or the principal (college-wide) approves or rejects
 * with a reason. No jobs — approvals only.
 */

import {
  assertModuleWiring,
  type AuditLogger,
  type Db,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { leaveModuleDefinition } from "./definition";
import { createLeaveHandlers } from "./handlers";
import { createLeaveRepo } from "./repo";

export { MODULE_NAME as LEAVE_MODULE_NAME, leaveModuleDefinition } from "./definition";

export interface LeaveModuleDeps {
  readonly db: Db;
  readonly audit: AuditLogger;
  readonly peopleDirectory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
}

export function createLeaveModule(deps: LeaveModuleDeps): RuntimeModule<Record<string, never>> {
  const repo = createLeaveRepo(deps.db);
  const module: RuntimeModule<Record<string, never>> = {
    definition: leaveModuleDefinition,
    handlers: createLeaveHandlers({
      repo,
      directory: deps.peopleDirectory,
      audit: deps.audit,
      scopeChecker: deps.scopeChecker,
    }),
    jobProcessors: {},
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
