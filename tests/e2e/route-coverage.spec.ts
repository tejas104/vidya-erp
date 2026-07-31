import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { moduleDefinitions } from "../../scripts/registry";

/**
 * JOURNEY 9 — license-agnostic route-coverage smoke.
 *
 * Enumerates every RouteSpec declared across the module definition.ts files
 * and asserts, for each, that (a) a Next.js route.ts exists on disk and
 * (b) the endpoint responds non-404 over real HTTP. This is the structural
 * guard that makes the orphaned-route class (16 handlers with no route file)
 * impossible to reintroduce: add a RouteSpec without a route.ts and this
 * suite goes red.
 *
 * Unauthenticated is deliberate — the auth gate runs before param/query
 * validation, so a registered protected route answers 401 (not 404). A
 * missing route.ts is the only thing that yields 404 here.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appDir = path.join(repoRoot, "apps", "web", "app");

/** "/api/v1/exams/series/{seriesId}" -> apps/web/app/api/v1/exams/series/[seriesId]/route.ts */
function routeFileFor(specPath: string): string {
  const segments = specPath.replace(/^\//, "").split("/").map((s) => s.replace(/^\{(.+)\}$/, "[$1]"));
  return path.join(appDir, ...segments, "route.ts");
}

/** Concrete probe URL: dynamic segments filled with a throwaway id. */
function probeUrl(specPath: string): string {
  return specPath.replace(/\{[^}]+\}/g, "e2e-probe");
}

const allRoutes = moduleDefinitions.flatMap((def) =>
  def.routes.map((r) => ({ module: def.name, id: r.id, method: r.method, path: r.path })),
);
const distinctFiles = new Set(allRoutes.map((r) => routeFileFor(r.path)));

test("route inventory: every RouteSpec has a route.ts and answers non-404", async ({ request }) => {
  // Probes every route sequentially; against a dev server each route compiles
  // on first hit, so allow generous headroom (a production `next start` is fast).
  test.setTimeout(240_000);
  const missingFiles: string[] = [];
  const notReachable: string[] = [];

  for (const route of allRoutes) {
    if (!existsSync(routeFileFor(route.path))) {
      missingFiles.push(`${route.id} (${route.method} ${route.path})`);
      continue;
    }
    // The dev server compiles routes on first hit; tolerate a transient
    // connection drop with one retry. A missing route.ts is what we care
    // about, and the filesystem check above already catches that.
    let status = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await request.fetch(probeUrl(route.path), { method: route.method, timeout: 20_000 });
        status = res.status();
        break;
      } catch (err) {
        if (attempt === 1) throw err;
        await new Promise((r) => setTimeout(r, 750));
      }
    }
    if (status === 404) {
      notReachable.push(`${route.id} -> ${route.method} ${route.path} => 404`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[route-coverage] ${allRoutes.length} RouteSpecs across ${moduleDefinitions.length} modules; ` +
      `${distinctFiles.size} distinct route.ts files; ` +
      `${missingFiles.length} missing files; ${notReachable.length} returned 404`,
  );

  expect(missingFiles, `RouteSpecs with no route.ts:\n${missingFiles.join("\n")}`).toEqual([]);
  expect(notReachable, `Registered routes returning 404:\n${notReachable.join("\n")}`).toEqual([]);
});
