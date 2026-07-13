/**
 * @vidya/module-notices — PUBLIC API (the only importable surface).
 *
 * The staff-room noticeboard: admin/principal compose with an audience and a
 * publish window; readers get a server-filtered live feed. Visibility is
 * derived (audience org-path × the caller's grants or enrollment) — never
 * fanned out per user, never trusted from the client.
 */

import {
  assertModuleWiring,
  type AuditLogger,
  type Db,
  type RuntimeModule,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { noticesModuleDefinition } from "./definition";
import { createNoticesHandlers } from "./handlers";
import { createNoticesRepo } from "./repo";

export { MODULE_NAME as NOTICES_MODULE_NAME, noticesModuleDefinition } from "./definition";

export interface NoticesModuleDeps {
  readonly db: Db;
  readonly audit: AuditLogger;
  readonly peopleDirectory: PeopleDirectory;
}

export function createNoticesModule(deps: NoticesModuleDeps): RuntimeModule<Record<string, never>> {
  const repo = createNoticesRepo(deps.db);
  const module: RuntimeModule<Record<string, never>> = {
    definition: noticesModuleDefinition,
    handlers: createNoticesHandlers({ repo, directory: deps.peopleDirectory }),
    jobProcessors: {},
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
