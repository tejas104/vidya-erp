import { expect, test } from "@playwright/test";
import { moduleDefinitions } from "../../scripts/registry";

/**
 * JOURNEY 9 — license-agnostic route-coverage smoke.
 *
 * Enumerates every RouteSpec declared across the module definition.ts files
 * and asserts each endpoint responds non-404 over real HTTP. This is the
 * structural guard that makes the orphaned-route class (16 handlers with no
 * route file) impossible to reintroduce: add a RouteSpec without a route.ts
 * and this suite goes red — a missing route.ts 404s here same as any other
 * unreachable route. The filesystem-only half of this check (RouteSpec has a
 * matching route.ts on disk, no server needed) now runs as a zero-infra unit
 * test: scripts/route-coverage.test.ts. This spec is the HTTP-reachability
 * half, which does need the build/compose/worker stack.
 *
 * Unauthenticated is deliberate — the auth gate runs before param/query
 * validation, so a registered protected route answers 401 (not 404). A
 * missing route.ts is the only thing that yields 404 here.
 */

/** Concrete probe URL: dynamic segments filled with a throwaway id. */
function probeUrl(specPath: string): string {
  return specPath.replace(/\{[^}]+\}/g, "e2e-probe");
}

const allRoutes = moduleDefinitions.flatMap((def) =>
  def.routes.map((r) => ({ module: def.name, id: r.id, method: r.method, path: r.path })),
);

test("route inventory: every RouteSpec answers non-404", async ({ request }) => {
  // Probes every route sequentially; against a dev server each route compiles
  // on first hit, so allow generous headroom (a production `next start` is fast).
  test.setTimeout(240_000);
  const notReachable: string[] = [];

  for (const route of allRoutes) {
    // Tolerate a transient connection drop with one retry.
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
      `${notReachable.length} returned 404`,
  );

  expect(notReachable, `Registered routes returning 404:\n${notReachable.join("\n")}`).toEqual([]);
});
