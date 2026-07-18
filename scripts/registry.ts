import { createRequire } from "node:module";
import path from "node:path";
import type { ModuleDefinition, ModuleMigrationSource } from "@vidya/platform";
import { systemModuleDefinition } from "@vidya/module-system";
import { identityModuleDefinition } from "@vidya/module-identity";
import { peopleModuleDefinition } from "@vidya/module-people";
import { academicsModuleDefinition } from "@vidya/module-academics";
import { analyticsModuleDefinition } from "@vidya/module-analytics";
import { reportingModuleDefinition } from "@vidya/module-reporting";
import { portalModuleDefinition } from "@vidya/module-portal";
import { timetableModuleDefinition } from "@vidya/module-timetable";
import { courseworkModuleDefinition } from "@vidya/module-coursework";
import { syllabusModuleDefinition } from "@vidya/module-syllabus";
import { feesModuleDefinition } from "@vidya/module-fees";
import { noticesModuleDefinition } from "@vidya/module-notices";
import { resultsModuleDefinition } from "@vidya/module-results";
import { examsModuleDefinition } from "@vidya/module-exams";
import { leaveModuleDefinition } from "@vidya/module-leave";

/**
 * Tooling-side module registry. New modules are added here (one line) and in
 * the two composition roots — see docs/how-to-add-a-module.md. Only static
 * module definitions are imported: no database, Redis or config is touched.
 */
export const moduleDefinitions: readonly ModuleDefinition[] = [
  systemModuleDefinition,
  identityModuleDefinition,
  peopleModuleDefinition,
  academicsModuleDefinition,
  analyticsModuleDefinition,
  reportingModuleDefinition,
  portalModuleDefinition,
  timetableModuleDefinition,
  courseworkModuleDefinition,
  syllabusModuleDefinition,
  feesModuleDefinition,
  noticesModuleDefinition,
  resultsModuleDefinition,
  examsModuleDefinition,
  leaveModuleDefinition,
];

const require = createRequire(import.meta.url);

export function modulePackageDir(moduleName: string): string {
  return path.dirname(require.resolve(`@vidya/module-${moduleName}/package.json`));
}

export function migrationSources(): ModuleMigrationSource[] {
  return moduleDefinitions.map((definition) => ({
    module: definition.name,
    dir: path.join(modulePackageDir(definition.name), definition.migrationsDir),
  }));
}
