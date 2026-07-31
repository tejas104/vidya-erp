// Fails if any CSS hex (#abc/#aabbcc) or rgb()/rgba() literal appears in a
// styling source OUTSIDE tokens.css and files on the shrinking ignore-list.
// S2 empties IGNORE as screens migrate; when IGNORE is [], globals.css is gone.
import { readFileSync, globSync } from "node:fs";
const IGNORE = new Set([
  "apps/web/app/globals.css",            // legacy sheet — S2 deletes it
  // add nothing here; only remove as screens migrate
]);
const ALLOW = "packages/ui-system/src/tokens.css";
// Exclude deps and build output explicitly — .next/dist/coverage hold hashed,
// hex-laden generated CSS that would false-fail the gate after any build.
const files = globSync("{apps,packages}/**/*.{css,module.css}", {
  exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/.turbo/**"],
});
// hex, plus the CSS color FUNCTIONS (rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch/
// color) — so a literal can't dodge the gate by switching notation (e.g.
// rgba(255,255,255,.18) -> hsl(0 0% 100% / 18%)). Named colors are not matched
// (regex would false-trip on `white-space` etc.); reviewers catch those.
const hex = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;
const offenders = [];
for (const f of files) {
  const rel = f.replaceAll("\\", "/");
  if (rel === ALLOW || IGNORE.has(rel)) continue;
  // Blank out block comments (preserve newlines so line numbers stay accurate)
  // and url(...) refs (e.g. SVG fragment ids like url(#fade)) before scanning,
  // so a hex inside a comment or an SVG ref never false-trips the gate.
  const src = readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/url\([^)]*\)/g, "url()");
  src.split("\n").forEach((l, i) => {
    if (hex.test(l)) offenders.push(`${rel}:${i + 1}: ${l.trim()}`);
  });
}
if (offenders.length) {
  console.error("Ad-hoc color literals found outside tokens.css:\n" + offenders.join("\n"));
  process.exit(1);
}
console.log("no ad-hoc color literals ✓");
