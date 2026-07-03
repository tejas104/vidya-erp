import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { migrationSources, moduleDefinitions, modulePackageDir } from "./registry";

/**
 * Constitution rule 2 gate: every module touches only tables carrying its
 * own prefix.
 *
 * Static-analysis heuristic (documented in ADR-0001):
 *  1. every CREATE/ALTER/DROP TABLE in a module's migrations must target a
 *     table with the module's prefix;
 *  2. no module's migrations or source may mention another module's prefix,
 *     nor the platform-owned journal table platform_migrations;
 *  3. every pgTable("...") in a module's Drizzle schema must carry the
 *     module's prefix.
 * Runtime access control is layered on top by the boundary lint + package
 * exports (schema objects are module-internal, so foreign-table queries
 * would need a deep import, which fails the build).
 */

const TABLE_DDL_PATTERN =
  /\b(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
const PG_TABLE_PATTERN = /\bpgTable\(\s*["']([a-z0-9_]+)["']/g;
const JOURNAL_TABLE = "platform_migrations";

async function listFilesRecursive(dir: string, extension: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(fullPath, extension)));
    } else if (entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }
  return results;
}

async function main(): Promise<void> {
  const violations: string[] = [];
  const allPrefixes = moduleDefinitions.map((definition) => definition.tablePrefix);

  for (const definition of moduleDefinitions) {
    const foreignPrefixes = allPrefixes.filter((prefix) => prefix !== definition.tablePrefix);
    const source = migrationSources().find((entry) => entry.module === definition.name);
    if (source === undefined) {
      throw new Error(`no migration source for module "${definition.name}"`);
    }

    const sqlFiles = await listFilesRecursive(source.dir, ".sql");
    for (const filePath of sqlFiles) {
      const contents = await readFile(filePath, "utf8");
      const label = `${definition.name}: ${path.basename(filePath)}`;
      for (const match of contents.matchAll(TABLE_DDL_PATTERN)) {
        const table = match[1] ?? "";
        if (!table.startsWith(definition.tablePrefix)) {
          violations.push(`${label}: DDL targets "${table}" outside prefix "${definition.tablePrefix}"`);
        }
      }
      if (contents.includes(JOURNAL_TABLE)) {
        violations.push(`${label}: references the platform-owned journal table "${JOURNAL_TABLE}"`);
      }
      for (const prefix of foreignPrefixes) {
        if (contents.includes(prefix)) {
          violations.push(`${label}: references another module's table prefix "${prefix}"`);
        }
      }
    }

    const srcDir = path.join(modulePackageDir(definition.name), "src");
    const tsFiles = await listFilesRecursive(srcDir, ".ts");
    for (const filePath of tsFiles) {
      const contents = await readFile(filePath, "utf8");
      const label = `${definition.name}: src/${path.relative(srcDir, filePath).replaceAll("\\", "/")}`;
      for (const match of contents.matchAll(PG_TABLE_PATTERN)) {
        const table = match[1] ?? "";
        if (!table.startsWith(definition.tablePrefix)) {
          violations.push(`${label}: pgTable("${table}") outside prefix "${definition.tablePrefix}"`);
        }
      }
      if (contents.includes(JOURNAL_TABLE)) {
        violations.push(`${label}: references the platform-owned journal table "${JOURNAL_TABLE}"`);
      }
      for (const prefix of foreignPrefixes) {
        if (contents.includes(prefix)) {
          violations.push(`${label}: references another module's table prefix "${prefix}"`);
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("table-ownership violations (Constitution rule 2):");
    for (const violation of violations) {
      console.error(`  ${violation}`);
    }
    process.exit(1);
  }
  console.log(
    `table ownership verified for ${moduleDefinitions.length} module(s): ${allPrefixes.join(", ")}`,
  );
}

main().catch((error: unknown) => {
  console.error("table-ownership check failed:", error);
  process.exit(1);
});
