// Fails if any CSS hex (#abc/#aabbcc) or rgb()/rgba() literal appears in a
// styling source OUTSIDE tokens.css and files on the shrinking ignore-list.
// S2 empties IGNORE as screens migrate; when IGNORE is [], globals.css is gone.
import { readFileSync, globSync } from "node:fs";
const IGNORE = new Set([
  "apps/web/app/globals.css",            // legacy sheet — S2 deletes it
  // add nothing here; only remove as screens migrate
]);
const ALLOW = "packages/ui-system/src/tokens.css";
const files = globSync("{apps,packages}/**/*.{css,module.css}", { exclude: ["**/node_modules/**"] });
const hex = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
const offenders = [];
for (const f of files) {
  const rel = f.replaceAll("\\", "/");
  if (rel === ALLOW || IGNORE.has(rel)) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => { if (hex.test(l)) offenders.push(`${rel}:${i + 1}: ${l.trim()}`); });
}
if (offenders.length) {
  console.error("Ad-hoc color literals found outside tokens.css:\n" + offenders.join("\n"));
  process.exit(1);
}
console.log("no ad-hoc color literals ✓");
