import type { LicenseStatus, Metrics, Principal, ReadinessCheck, RouteHandler } from "@vidya/platform";
import type { PreferencesStore } from "../service/preferences";
import type { AuditLogRecord } from "../service/audit-writer";

export interface SystemHandlerDeps {
  readonly metrics: Metrics;
  readonly serviceVersion: string;
  /** Provided by the composition root; true once SIGTERM has been received. */
  readonly isDraining: () => boolean;
  /** Postgres/Redis reachability checks, injected by the composition root. */
  readonly infrastructureChecks: readonly ReadinessCheck[];
  /** Per-user keyed preference store (#11 task 11). */
  readonly preferences: PreferencesStore;
  /** Verified once at boot by the composition root (#12 step 4). */
  readonly license: () => LicenseStatus;
  /** Active-student seat usage, late-bound from the people module (#11.75 item 1). */
  readonly countActiveStudents: () => Promise<number>;
  /** The existing audit read-back functions, bound to the db by the factory. */
  readonly readRecentAuditEvents: (limit: number) => Promise<AuditLogRecord[]>;
  readonly readAuditEventsByAction: (action: string, limit: number) => Promise<AuditLogRecord[]>;
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

  // Auth is STAFF_ONLY (RouteSpec: every role except student), so a 403
  // never reaches this closure for a student — the API layer's half of
  // "students never see licensing state"; the UI's half is LicenseBanner
  // never fetching for a student session. Full status is returned to any
  // staff caller; which parts of it render as a banner (admin gets every
  // state, other staff only the ≤7-day warning) is a client-side decision.
  const license: RouteHandler = async () => {
    const studentCount = await deps.countActiveStudents();
    return { status: 200, body: { ...deps.license(), studentCount } };
  };

  // Auth is ADMIN_ONLY (RouteSpec), so the role gate has already rejected any
  // non-admin with a 403 before this closure runs — the rows carry usernames,
  // IPs and user agents in `details`. Read-only: no scope narrowing exists for
  // an audit log, the whole log is one admin-wide resource.
  const auditLog: RouteHandler = async (ctx) => {
    const { action, limit } = ctx.request.query as { action?: string; limit: number };
    const rows =
      action === undefined
        ? await deps.readRecentAuditEvents(limit)
        : await deps.readAuditEventsByAction(action, limit);
    return {
      status: 200,
      body: {
        events: rows.map((row) => ({
          id: row.id,
          occurredAt: row.occurredAt.toISOString(),
          module: row.module,
          action: row.action,
          actorType: row.actorType,
          actorId: row.actorId,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          requestId: row.requestId,
          details: (row.details ?? {}) as Record<string, unknown>,
        })),
        limit,
        truncated: rows.length === limit,
      },
    };
  };

  return {
    "system.health": health,
    "system.ready": ready,
    "system.metrics": metrics,
    "system.preference-get": preferenceGet,
    "system.preference-set": preferenceSet,
    "system.license": license,
    "system.audit-log": auditLog,
  };
}
