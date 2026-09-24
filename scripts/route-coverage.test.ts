import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moduleDefinitions } from "./registry";

/**
 * Filesystem half of JOURNEY 9 (tests/e2e/route-coverage.spec.ts): every
 * RouteSpec declared in a module's definition.ts must have a matching
 * Next.js route.ts on disk. Split out of that e2e spec (#11 fix wave) so this
 * half — which needs no prod build, compose stack or worker — runs in the
 * plain unit suite; the HTTP-reachability half stays in e2e. Keep routeFileFor
 * in sync with the copy in tests/e2e/route-coverage.spec.ts if either changes.
 */
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(repoRoot, "apps", "web", "app");

/** "/api/v1/exams/series/{seriesId}" -> apps/web/app/api/v1/exams/series/[seriesId]/route.ts */
function routeFileFor(specPath: string): string {
  const segments = specPath.replace(/^\//, "").split("/").map((s) => s.replace(/^\{(.+)\}$/, "[$1]"));
  return path.join(appDir, ...segments, "route.ts");
}

describe("route inventory", () => {
  it("every RouteSpec has a matching route.ts on disk", () => {
    const allRoutes = moduleDefinitions.flatMap((def) =>
      def.routes.map((r) => ({ module: def.name, id: r.id, method: r.method, path: r.path })),
    );
    const missing = allRoutes
      .filter((route) => !existsSync(routeFileFor(route.path)))
      .map((route) => `${route.id} (${route.method} ${route.path})`);
    expect(missing, `RouteSpecs with no route.ts:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every API route delegates to the shared route handler", () => {
    const apiDir = path.join(appDir, "api");
    function routeFiles(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        return entry.isDirectory() ? routeFiles(fullPath) : entry.name === "route.ts" ? [fullPath] : [];
      });
    }
    const bypasses = routeFiles(apiDir)
      .filter((file) => !readFileSync(file, "utf8").includes("routeHandler("))
      .map((file) => path.relative(repoRoot, file));
    expect(bypasses).toEqual([]);
  });

  it("keeps public and guardian route audiences explicit", () => {
    const routes = moduleDefinitions.flatMap((def) => def.routes);
    expect(routes.filter((route) => route.auth.public).map((route) => route.id).sort()).toEqual([
      "identity.login", "identity.password-reset-confirm", "people.guardian-activate",
      "system.health", "system.metrics", "system.ready",
    ]);
    expect(routes.filter((route) => !route.auth.public && route.auth.requirement.audience === "guardian")
      .map((route) => route.id).sort()).toEqual([
        "fees.child-fees", "notices.child-visible",
        "people.guardian-children", "people.guardian-redeem", "portal.child-attendance",
        "portal.child-marks", "portal.child-timetable", "portal.child-today",
      ]);
  });

  // ADR-0027 Finding C: "any" admits guardians, so it is reserved for routes
  // about the caller's own session. A new route using it must be added here
  // deliberately, with a reason, never by default.
  it("uses audience \"any\" only on the session self-service routes", () => {
    const anyAudience = moduleDefinitions
      .flatMap((def) => def.routes)
      .filter((route) => !route.auth.public && route.auth.requirement.audience === "any")
      .map((route) => route.id)
      .sort();
    expect(anyAudience).toEqual(["identity.logout", "identity.password-change", "identity.session"]);
  });
});
