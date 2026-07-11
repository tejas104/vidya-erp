/**
 * @vidya/module-portal — PUBLIC API (the only importable surface).
 *
 * The student portal: self-scoped, read-only views for signed-in students.
 * No tables, no jobs — a pure serving layer composed from the public
 * PeopleDirectory (identity link resolution, names) and AcademicsReadModel
 * (the student's own attendance/marks). Routes are student-role-gated and
 * never accept a studentId; the identity link is the record authority
 * (W1, docs/superpowers/specs/2026-07-11-saas-program.md).
 */

import { assertModuleWiring, type RuntimeModule } from "@vidya/platform";
import type { AcademicsReadModel } from "@vidya/module-academics";
import type { PeopleDirectory } from "@vidya/module-people";
import { portalModuleDefinition } from "./definition";
import { createPortalHandlers } from "./handlers";

export { MODULE_NAME as PORTAL_MODULE_NAME, portalModuleDefinition } from "./definition";

export interface PortalModuleDeps {
  readonly peopleDirectory: PeopleDirectory;
  readonly academicsRead: AcademicsReadModel;
}

export function createPortalModule(deps: PortalModuleDeps): RuntimeModule<Record<string, never>> {
  const module: RuntimeModule<Record<string, never>> = {
    definition: portalModuleDefinition,
    handlers: createPortalHandlers({
      directory: deps.peopleDirectory,
      academicsRead: deps.academicsRead,
    }),
    jobProcessors: {},
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
