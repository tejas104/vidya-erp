import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Constitution rules 14–15: no deferred-work markers in non-test code.
 * Marker strings are assembled at runtime so this checker never flags
 * itself. Test files are exempt by the assignment's definition ("non-test
 * code"); documentation prose is out of scope (code files only).
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "coverage", "docs"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sql", ".yml", ".yaml"]);
const CODE_FILENAMES = new Set(["Dockerfile", "Makefile"]);

const MARKERS = ["TO" + "DO", "FIX" + "ME", "XX" + "X", "HA" + "CK", "PLACE" + "HOLDER"];
const MARKER_PATTERN = new RegExp(`\\b(${MARKERS.join("|")})\\b`);

function isTestPath(relative: string): boolean {
  return (
    relative.includes(".test.") ||
    relative.includes(".int.test.") ||
    relative.split(path.sep)[0] === "tests"
  );
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const fullPath = path.join(dir, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}

async function main(): Promise<void> {
  const violations: string[] = [];
  for await (const filePath of walk(REPO_ROOT)) {
    const relative = path.relative(REPO_ROOT, filePath);
    const base = path.basename(filePath);
    if (!CODE_EXTENSIONS.has(path.extname(filePath)) && !CODE_FILENAMES.has(base)) {
      continue;
    }
    if (isTestPath(relative)) {
      continue;
    }
    const contents = await readFile(filePath, "utf8");
    const lines = contents.split("\n");
    for (const [index, line] of lines.entries()) {
      if (MARKER_PATTERN.test(line)) {
        violations.push(`${relative}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  if (violations.length > 0) {
    console.error("deferred-work markers found in non-test code (Constitution rules 14-15):");
    for (const violation of violations) {
      console.error(`  ${violation}`);
    }
    process.exit(1);
  }
  console.log("no deferred-work markers found");
}

main().catch((error: unknown) => {
  console.error("marker check failed:", error);
  process.exit(1);
});
