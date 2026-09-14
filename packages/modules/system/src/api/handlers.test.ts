import { describe, expect, it } from "vitest";
import { pino } from "pino";
import {
  createMetrics,
  type Principal,
  type ReadinessCheck,
  type RouteContext,
} from "@vidya/platform";
import { createSystemHandlers, type SystemHandlerDeps } from "./handlers";
import type { PreferencesStore } from "../service/preferences";
import type { SysUserPreferenceRow } from "../db/schema";
import type { AuditLogRecord } from "../service/audit-writer";

const logger = pino({ level: "silent" });

function ctx(): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal: null,
    request: { params: undefined, query: undefined, body: undefined, headers: new Headers() },
  };
}

function principal(id: string): Principal {
  return {
    id,
    kind: "user",
    displayName: null,
    roles: ["teacher"],
    scopes: [],
    grants: [],
    sessionId: `sess_${id}`,
  };
}

function preferenceCtx(
  who: Principal,
  params: { key: string },
  body?: { value: unknown },
): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal: who,
    request: { params, query: undefined, body, headers: new Headers() },
  };
}

/** In-memory PreferencesStore fake — a real, keyed (userId, key) map, so a
 * handler that ever trusted a request-supplied user id (instead of
 * ctx.principal.id) would leak across the two principals used below. */
function fakePreferencesStore(): PreferencesStore {
  const rows = new Map<string, SysUserPreferenceRow>();
  return {
    async get(userId, key) {
      return rows.get(`${userId}|${key}`) ?? null;
    },
    async set(userId, key, value) {
      const row: SysUserPreferenceRow = { userId, key, value, updatedAt: new Date() };
      rows.set(`${userId}|${key}`, row);
      return row;
    },
  };
}

function makeDeps(overrides: Partial<SystemHandlerDeps> = {}): SystemHandlerDeps {
  return {
    metrics: createMetrics({ serviceName: "test", defaultMetrics: false }),
    serviceVersion: "0.1.0-test",
    isDraining: () => false,
    infrastructureChecks: [],
    preferences: fakePreferencesStore(),
    license: () => ({ kind: "absent" }),
    countActiveStudents: async () => 0,
    readScopedAuditEvents: async () => [],
    scopeChecker: {
      check: (caller, _action, resource) => ({
        granted: caller.grants.some((grant) => grant.org.collegeId === resource.org.collegeId),
        reason: "test containment",
      }),
    },
    ...overrides,
  };
}

const passing: ReadinessCheck = { name: "postgres", check: async () => undefined };
const failing: ReadinessCheck = {
  name: "redis",
  check: async () => {
    throw new Error("connection refused at redis://internal:6379");
  },
};

describe("system.health", () => {
  it("reports liveness with uptime and version", async () => {
    const handlers = createSystemHandlers(makeDeps());
    const result = await handlers["system.health"]!(ctx());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "ok", version: "0.1.0-test" });
    expect((result.body as { uptimeSeconds: number }).uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("system.ready", () => {
  it("returns 200 ready when every check passes", async () => {
    const handlers = createSystemHandlers(makeDeps({ infrastructureChecks: [passing] }));
    const result = await handlers["system.ready"]!(ctx());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "ready", checks: [{ name: "postgres", ok: true }] });
  });

  it("returns 503 unready when a check fails, without leaking the error", async () => {
    const handlers = createSystemHandlers(
      makeDeps({ infrastructureChecks: [passing, failing] }),
    );
    const result = await handlers["system.ready"]!(ctx());
    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      status: "unready",
      checks: [
        { name: "postgres", ok: true },
        { name: "redis", ok: false },
      ],
    });
    expect(JSON.stringify(result.body)).not.toContain("connection refused");
  });

  it("returns 503 draining once shutdown has begun, without running checks", async () => {
    let checked = false;
    const spyCheck: ReadinessCheck = {
      name: "postgres",
      check: async () => {
        checked = true;
      },
    };
    const handlers = createSystemHandlers(
      makeDeps({ isDraining: () => true, infrastructureChecks: [spyCheck] }),
    );
    const result = await handlers["system.ready"]!(ctx());
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ status: "draining", checks: [] });
    expect(checked).toBe(false);
  });

  it("treats a hung dependency as failed (check timeout)", async () => {
    const hung: ReadinessCheck = { name: "postgres", check: () => new Promise(() => undefined) };
    const handlers = createSystemHandlers(makeDeps({ infrastructureChecks: [hung] }));
    const result = await handlers["system.ready"]!(ctx());
    expect(result.status).toBe(503);
  }, 10_000);
});

describe("system.metrics", () => {
  it("returns Prometheus text exposition", async () => {
    const deps = makeDeps();
    deps.metrics.httpRequestsTotal.inc({
      module: "system",
      route: "system.health",
      method: "GET",
      status: "200",
    });
    const handlers = createSystemHandlers(deps);
    const result = await handlers["system.metrics"]!(ctx());
    expect(result.status).toBe(200);
    expect(result.contentType).toContain("text/plain");
    expect(String(result.body)).toContain("vidya_http_requests_total");
  });
});

describe("system.preference-get / system.preference-set", () => {
  it("writes and reads back the caller's own preference", async () => {
    const handlers = createSystemHandlers(makeDeps());
    const alice = principal("usr_alice");

    const putResult = await handlers["system.preference-set"]!(
      preferenceCtx(alice, { key: "onboarding" }, { value: { dismissed: true } }),
    );
    expect(putResult.status).toBe(200);
    expect(putResult.audit?.resourceId).toBe("onboarding");

    const getResult = await handlers["system.preference-get"]!(
      preferenceCtx(alice, { key: "onboarding" }),
    );
    expect(getResult.status).toBe(200);
    expect(getResult.body).toMatchObject({ key: "onboarding", value: { dismissed: true } });
  });

  it("returns 404 for a key the caller has never set", async () => {
    const handlers = createSystemHandlers(makeDeps());
    const alice = principal("usr_alice");

    const result = await handlers["system.preference-get"]!(
      preferenceCtx(alice, { key: "never-set" }),
    );
    expect(result.status).toBe(404);
  });

  // THE security property (Constitution: reads/writes are always scoped to
  // the caller's own principal.id, never a request-supplied id). Both
  // principals use the IDENTICAL key against the SAME store instance; if the
  // handler ever read a user id from params/body/query instead of
  // ctx.principal, this test fails.
  it("a second user's identical key is completely invisible to the caller", async () => {
    const store = fakePreferencesStore();
    const handlers = createSystemHandlers(makeDeps({ preferences: store }));
    const alice = principal("usr_alice");
    const bob = principal("usr_bob");

    const setResult = await handlers["system.preference-set"]!(
      preferenceCtx(alice, { key: "theme" }, { value: { mode: "dark", secret: "alice-only" } }),
    );
    expect(setResult.status).toBe(200);

    // Bob asks for the exact same key. There is no field anywhere in his
    // request that names Alice — nothing to trust even if the handler tried.
    const bobGet = await handlers["system.preference-get"]!(
      preferenceCtx(bob, { key: "theme" }),
    );
    expect(bobGet.status).toBe(404);
    expect(JSON.stringify(bobGet.body ?? "")).not.toContain("alice-only");

    // Bob writes his own value under the same key; Alice's is untouched.
    const bobSet = await handlers["system.preference-set"]!(
      preferenceCtx(bob, { key: "theme" }, { value: { mode: "light" } }),
    );
    expect(bobSet.status).toBe(200);

    const aliceGetAgain = await handlers["system.preference-get"]!(
      preferenceCtx(alice, { key: "theme" }),
    );
    expect(aliceGetAgain.body).toMatchObject({ value: { mode: "dark", secret: "alice-only" } });
  });

  it("overwrites the caller's own previous value for the same key (upsert)", async () => {
    const handlers = createSystemHandlers(makeDeps());
    const alice = principal("usr_alice");

    await handlers["system.preference-set"]!(
      preferenceCtx(alice, { key: "theme" }, { value: { mode: "dark" } }),
    );
    const second = await handlers["system.preference-set"]!(
      preferenceCtx(alice, { key: "theme" }, { value: { mode: "light" } }),
    );
    expect(second.status).toBe(200);

    const getResult = await handlers["system.preference-get"]!(
      preferenceCtx(alice, { key: "theme" }),
    );
    expect(getResult.body).toMatchObject({ value: { mode: "light" } });
  });
});

describe("system.license", () => {
  it("merges the boot-verified status with the live active-student count", async () => {
    const handlers = createSystemHandlers(
      makeDeps({
        license: () => ({ kind: "valid", claims: { v: 1, id: "lic_1", customer: "Northgate", edition: "college", issuedAt: "2026-01-01", expiresAt: "2027-01-01", seats: 500 }, daysRemaining: 90 }),
        countActiveStudents: async () => 247,
      }),
    );
    const result = await handlers["system.license"]!(ctx());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ kind: "valid", studentCount: 247, claims: { customer: "Northgate", seats: 500 } });
  });

  it("never enforces anything: an absent license still returns 200 with the count", async () => {
    const handlers = createSystemHandlers(
      makeDeps({ license: () => ({ kind: "absent" }), countActiveStudents: async () => 3 }),
    );
    const result = await handlers["system.license"]!(ctx());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ kind: "absent", studentCount: 3 });
  });
});

describe("system.audit-log", () => {
  const row = (over: Partial<AuditLogRecord> = {}): AuditLogRecord => ({
    id: 1,
    occurredAt: new Date("2026-09-12T10:00:00.000Z"),
    module: "identity",
    action: "identity.login-failed",
    actorType: "anonymous",
    actorId: null,
    resourceType: "session",
    resourceId: null,
    requestId: "req-9",
    org: { collegeId: "college-1" },
    details: { username: "asha" },
    ...over,
  });

  function auditCtx(query: { action?: string; limit: number }): RouteContext {
    return {
      ...ctx(),
      principal: { id: "admin-1", kind: "user", displayName: "Admin", roles: ["admin"], scopes: [], sessionId: "sess-admin", grants: [{ role: "admin", org: { collegeId: "college-1" } }] },
      request: { ...ctx().request, query },
    };
  }

  it("reads the newest events and serialises occurredAt as ISO", async () => {
    const handlers = createSystemHandlers(makeDeps({ readScopedAuditEvents: async () => [row()] }));
    const result = await handlers["system.audit-log"]!(auditCtx({ limit: 50 }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      events: [
        {
          id: 1,
          occurredAt: "2026-09-12T10:00:00.000Z",
          module: "identity",
          action: "identity.login-failed",
          actorType: "anonymous",
          actorId: null,
          resourceType: "session",
          resourceId: null,
          requestId: "req-9",
          details: { username: "asha" },
        },
      ],
      limit: 50,
      truncated: false,
    });
  });

  it("routes to the by-action reader only when `action` is present, passing it through", async () => {
    const seen: string[] = [];
    const handlers = createSystemHandlers(
      makeDeps({
        readScopedAuditEvents: async (_collegeIds, action) => {
          seen.push(action ?? "recent");
          return [row({ action: "system.clock-rollback" })];
        },
      }),
    );
    const result = await handlers["system.audit-log"]!(auditCtx({ action: "system.clock-rollback", limit: 50 }));
    expect(seen).toEqual(["system.clock-rollback"]);
    expect(result.body).toMatchObject({ events: [{ action: "system.clock-rollback" }] });
  });

  it("flags truncated when a full page came back, so the UI can say older events exist", async () => {
    const handlers = createSystemHandlers(
      makeDeps({ readScopedAuditEvents: async (_collegeIds, _action, limit) => Array.from({ length: limit }, (_, i) => row({ id: i })) }),
    );
    const result = await handlers["system.audit-log"]!(auditCtx({ limit: 2 }));
    expect(result.body).toMatchObject({ limit: 2, truncated: true });
  });

  it("renders a null details column as an empty object rather than null", async () => {
    const handlers = createSystemHandlers(
      makeDeps({ readScopedAuditEvents: async () => [row({ details: null })] }),
    );
    const result = await handlers["system.audit-log"]!(auditCtx({ limit: 50 }));
    const { events } = result.body as { events: { details: unknown }[] };
    // Strictly `{}`, not merely object-like: toMatchObject({}) also accepts null.
    expect(events[0]!.details).toStrictEqual({});
  });

  it("removes a foreign-college candidate even if the repository is faulty", async () => {
    const handlers = createSystemHandlers(makeDeps({
      readScopedAuditEvents: async () => [row(), row({ id: 2, org: { collegeId: "college-2" } })],
    }));
    const result = await handlers["system.audit-log"]!(auditCtx({ limit: 50 }));
    expect(result.body).toMatchObject({ events: [{ id: 1 }] });
  });

  it("fails closed when the shared scope checker is unavailable", async () => {
    const handlers = createSystemHandlers(makeDeps({ scopeChecker: undefined }));
    expect((await handlers["system.audit-log"]!(auditCtx({ limit: 50 }))).status).toBe(403);
  });
});
