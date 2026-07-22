// Fails if a raw px value appears in a spacing/type property outside the
// --space-* / --text-* tokens, in any .module.css off the ignore-list.
// Sibling to check-no-adhoc-hex.mjs; wired into `check:styles`.
import { readFileSync, globSync } from "node:fs";
const IGNORE = new Set([
  "apps/web/app/globals.css", // legacy sheet — shrinks as screens migrate
]);
// Exclude deps and build output explicitly — same rationale as the hex gate.
const files = globSync("{apps,packages}/**/*.{css,module.css}", {
  exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/.turbo/**"],
});
// Spacing + type properties whose values must be tokens, not raw px. Matches
// the property name at a declaration boundary (start-of-line/`;`/`{`) so it
// can't false-match inside another property's value (e.g. `font-size` inside
// a `font:` shorthand isn't handled — those props aren't shorthand-composable
// with each other). Captures up to `;`/`}`/end-of-line so multiple
// declarations on one line are split into separate matches by the `g` flag.
const PROP = /(^|[\s;{])(padding|margin|gap|row-gap|column-gap|inset|font-size)(-[a-z]+)?\s*:\s*([^;}\n]*)/gi;
const RAWPX = /\b\d+(\.\d+)?px\b/;
const offenders = [];
for (const f of files) {
  const rel = f.replaceAll("\\", "/");
  if (IGNORE.has(rel)) continue;
  const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    let m;
    const re = new RegExp(PROP.source, "gi");
    while ((m = re.exec(line))) {
      const value = m[4];
      if (RAWPX.test(value)) offenders.push(`${rel}:${i + 1}: ${m[2]}${m[3] ?? ""}: ${value.trim()}`);
    }
  });
}
if (offenders.length) {
  console.error("Off-scale raw px in spacing/type (use var(--space-*)/var(--text-*)):\n" + offenders.join("\n"));
  process.exit(1);
}
console.log("spacing/type on-scale ✓");
