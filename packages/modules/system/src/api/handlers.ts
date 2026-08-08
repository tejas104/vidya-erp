import type { Metrics, Principal, ReadinessCheck, RouteHandler } from "@vidya/platform";
import type { PreferencesStore } from "../service/preferences";

export interface SystemHandlerDeps {
  readonly metrics: Metrics;
  readonly serviceVersion: string;
  /** Provided by the composition root; true once SIGTERM has been received. */
  readonly isDraining: () => boolean;
  /** Postgres/Redis reachability checks, injected by the composition root. */
  readonly infrastructureChecks: readonly ReadinessCheck[];
  /** Per-user keyed preference store (#11 task 11). */
  readonly preferences: PreferencesStore;
}

const CHECK_TIMEOUT_MS = 2_000;

async function runCheck(
  check: ReadinessCheck,
): Promise<{ name: string; ok: boolean; error?: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check.check(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`readiness check "${check.name}" timed out`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return { name: check.name, ok: true };
  } catch (error) {
    return { name: check.name, ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

export function createSystemHandlers(deps: SystemHandlerDeps): Record<string, RouteHandler> {
  const health: RouteHandler = async () => ({
    status: 200,
    body: {
      status: "ok" as const,
      uptimeSeconds: Math.round(process.uptime()),
      version: deps.serviceVersion,
    },
  });

  const ready: RouteHandler = async (ctx) => {
    if (deps.isDraining()) {
      return {
        status: 503,
        body: { status: "draining" as const, checks: [] },
      };
    }
    const results = await Promise.all(deps.infrastructureChecks.map(runCheck));
    for (const result of results) {
      if (!result.ok) {
        ctx.logger.warn({ check: result.name, err: result.error }, "readiness check failed");
      }
    }
    const allOk = results.every((result) => result.ok);
    return {
      status: allOk ? 200 : 503,
      body: {
        status: allOk ? ("ready" as const) : ("unready" as const),
        // Names and booleans only: dependency errors are logged, never
        // returned, so an unauthenticated probe cannot map internals.
        checks: results.map(({ name, ok }) => ({ name, ok })),
      },
    };
  };

  const metrics: RouteHandler = async () => ({
    status: 200,
    body: await deps.metrics.registry.metrics(),
    contentType: deps.metrics.registry.contentType,
  });

  // Auth is ANY_AUTHENTICATED, so defineRoute has already guaranteed a
  // non-null principal by the time either handler below runs.

  const preferenceGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { key: string };
    // Scoped to the caller's own id ONLY — never a request-supplied one.
    const row = await deps.preferences.get(principal.id, params.key);
    if (row === null) {
      return { status: 404, body: { message: "no such preference" } };
    }
    return {
      status: 200,
      body: { key: row.key, value: row.value, updatedAt: row.updatedAt.toISOString() },
    };
  };

  const preferenceSet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { key: string };
    const body = ctx.request.body as { value: unknown };
    // Scoped to the caller's own id ONLY — never a request-supplied one.
    const row = await deps.preferences.set(principal.id, params.key, body.value);
    return {
      status: 200,
      body: { key: row.key, value: row.value, updatedAt: row.updatedAt.toISOString() },
      audit: { resourceId: row.key },
    };
  };

  return {
    "system.health": health,
    "system.ready": ready,
    "system.metrics": metrics,
    "system.preference-get": preferenceGet,
    "system.preference-set": preferenceSet,
  };
}
