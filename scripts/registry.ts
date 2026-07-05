import { createRequire } from "node:module";
import path from "node:path";
import type { ModuleDefinition, ModuleMigrationSource } from "@vidya/platform";
import { systemModuleDefinition } from "@vidya/module-system";
import { identityModuleDefinition } from "@vidya/module-identity";
import { peopleModuleDefinition } from "@vidya/module-people";
import { academicsModuleDefinition } from "@vidya/module-academics";

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
