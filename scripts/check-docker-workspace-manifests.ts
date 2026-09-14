import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
async function packagesUnder(relativeRoot: string): Promise<string[]> {
  const directory = path.join(root, relativeRoot);
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = path.posix.join(relativeRoot.replaceAll("\\", "/"), entry.name, "package.json");
    try { await access(path.join(root, manifest)); found.push(manifest); } catch { /* not a workspace package */ }
  }
  return found;
}

const expected = [...await packagesUnder("apps"), ...await packagesUnder("packages"), ...await packagesUnder("packages/modules")].sort();
for (const dockerfile of ["apps/web/Dockerfile", "apps/worker/Dockerfile"]) {
  const source = await readFile(path.join(root, dockerfile), "utf8");
  const copied = new Set([...source.matchAll(/^COPY\s+(\S+\/package\.json)\s+/gm)].map((match) => match[1]!));
  const missing = expected.filter((manifest) => !copied.has(manifest));
  if (missing.length > 0) throw new Error(`${dockerfile} omits workspace manifests:\n${missing.map((item) => `  ${item}`).join("\n")}`);
}
console.log(`Docker manifest preinstall coverage verified for ${expected.length} workspace packages.`);
