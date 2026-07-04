import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RoleRequirementPolicy,
  createDb,
  createLogger,
  createMetrics,
  defineRoute,
  createRedis,
  type BoundRouteHandler,
  type RouteDependencies,
} from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";
import { createIdentityModule } from "@vidya/module-identity";
import { createTestIdentityCore } from "./support/identity-test-core";

/**
 * End-to-end identity flows through the REAL pipeline (defineRoute), REAL
 * Postgres (idn_* tables + sys_audit_log) and REAL Redis (throttle) — with
 * the identity core replaced by the labeled test double until the
 * human-owned implementation lands.
 */

const logger = createLogger({ level: "silent", serviceName: "vidya-int" });
const { pool, db } = createDb({
  url: process.env.DATABASE_URL ?? "",
  poolMax: 5,
  logger,
  applicationName: "vidya-int-identity",
});
const redis = createRedis({
  url: process.env.REDIS_URL ?? "",
  logger,
  connectionName: "vidya-int-identity",
});
const metrics = createMetrics({ serviceName: "vidya-int", defaultMetrics: false });

const system = createSystemModule({
  db,
  metrics,
  serviceVersion: "integration",
  isDraining: () => false,
  infrastructureChecks: [],
});
const identity = createIdentityModule({
  db,
  redis,
  metrics,
  audit: system.service.audit,
  core: createTestIdentityCore(),
  config: {
    session: { cookieName: "vidya_session", cookieSecure: false, ttlHours: 12, idleMinutes: 30 },
    resetTokenTtlMinutes: 30,
    throttle: { maxAttempts: 5, windowMinutes: 15 },
  },
});

const routeDeps: RouteDependencies = {
  logger,
  authenticator: identity.service.authenticator,
  accessPolicy: new RoleRequirementPolicy(),
  auditLogger: system.service.audit,
  metrics,
};

const handlers: Record<string, BoundRouteHandler> = {};
for (const route of identity.definition.routes) {
  handlers[route.id] = defineRoute(route, identity.handlers[route.id]!, routeDeps);
}

interface CallOptions {
  body?: unknown;
  cookie?: string;
  params?: Record<string, string>;
  ip?: string;
}

async function call(routeId: string, options: CallOptions = {}): Promise<Response> {
  const route = identity.definition.routes.find((entry) => entry.id === routeId);
  if (route === undefined) {
    throw new Error(`unknown route ${routeId}`);
  }
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  headers["x-forwarded-for"] = options.ip ?? "10.1.1.1";
  const request = new Request(`http://localhost${route.path}`, {
    method: route.method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return handlers[routeId]!(request, { params: Promise.resolve(options.params ?? {}) });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const token = /vidya_session=([^;]*)/.exec(header)?.[1] ?? "";
  return `vidya_session=${token}`;
}

const runId = randomUUID().slice(0, 8);
const ADMIN_PASSWORD = "integration-admin-pass-1";
const COLLEGE = "col-int";
let adminCookie = "";

beforeAll(async () => {
  try {
    await identity.service.bootstrapAdmin({
      username: "int-admin",
      displayName: "Integration Admin",
      password: ADMIN_PASSWORD,
      collegeId: COLLEGE,
    });
  } catch (error) {
    // A previous non-reset run already bootstrapped; the fixed password
    // below still logs in.
    if (!(error instanceof Error && error.message.includes("bootstrap refused"))) {
      throw error;
    }
  }
  const login = await call("identity.login", {
    body: { username: "int-admin", password: ADMIN_PASSWORD },
  });
  expect(login.status).toBe(200);
  adminCookie = sessionCookie(login);
});

afterAll(async () => {
  redis.disconnect();
  await pool.end();
});

async function auditActions(limit = 100): Promise<string[]> {
  const rows = await system.service.readRecentAuditEvents(limit);
  return rows.map((row) => row.action);
}

describe("session lifecycle", () => {
  it("rejects requests without a session and accepts the login cookie", async () => {
    expect((await call("identity.session")).status).toBe(401);
    const whoami = await call("identity.session", { cookie: adminCookie });
    expect(whoami.status).toBe(200);
    const body = (await whoami.json()) as { roles: string[]; grants: unknown[] };
    expect(body.roles).toContain("admin");
    expect(body.grants.length).toBeGreaterThan(0);
  });

  it("audits successful logins with the user as actor", async () => {
    const rows = await system.service.readRecentAuditEvents(50);
    const loginRow = rows.find((row) => row.action === "identity.login");
    expect(loginRow).toBeDefined();
    expect(loginRow?.actorType).toBe("user");
    expect(loginRow?.actorId).not.toBeNull();
  });

  it("logout invalidates the session and audits", async () => {
    const login = await call("identity.login", {
      body: { username: "int-admin", password: ADMIN_PASSWORD },
    });
    const cookie = sessionCookie(login);
    const logout = await call("identity.logout", { cookie });
    expect(logout.status).toBe(200);
    expect((await call("identity.session", { cookie })).status).toBe(401);
    expect(await auditActions()).toContain("identity.logout");
  });
});

describe("user administration end-to-end", () => {
  const username = `teacher-${runId}`;
  let userId = "";

  it("admin creates a user (must_reset) and the action is audited", async () => {
    const response = await call("identity.user-create", {
      cookie: adminCookie,
      body: {
        username,
        displayName: "Integration Teacher",
        collegeId: COLLEGE,
        temporaryPassword: "temporary-pass-123",
        roles: ["teacher"],
      },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; status: string };
    userId = body.id;
    expect(body.status).toBe("must_reset");
    expect(await auditActions()).toContain("identity.user-created");
  });

  it("must_reset blocks login until the admin-issued token is redeemed", async () => {
    const blocked = await call("identity.login", {
      body: { username, password: "temporary-pass-123" },
    });
    expect(blocked.status).toBe(403);

    const init = await call("identity.password-reset-init", {
      cookie: adminCookie,
      params: { userId },
    });
    expect(init.status).toBe(201);
    const { token } = (await init.json()) as { token: string };

    const confirm = await call("identity.password-reset-confirm", {
      body: { token, newPassword: "brand-new-pass-99" },
    });
    expect(confirm.status).toBe(200);

    const reuse = await call("identity.password-reset-confirm", {
      body: { token, newPassword: "another-pass-1234" },
      ip: "10.2.2.2",
    });
    expect(reuse.status).toBe(401);

    const login = await call("identity.login", {
      body: { username, password: "brand-new-pass-99" },
    });
    expect(login.status).toBe(200);
    const actions = await auditActions();
    expect(actions).toContain("identity.password-reset-initiated");
    expect(actions).toContain("identity.password-reset-completed");
  });

  it("self-access: the user reads their own profile but not the admin's", async () => {
    const login = await call("identity.login", {
      body: { username, password: "brand-new-pass-99" },
    });
    const cookie = sessionCookie(login);
    const own = await call("identity.user-get", { cookie, params: { userId } });
    expect(own.status).toBe(200);

    const admins = await pool.query(
      "SELECT user_id FROM idn_user_roles WHERE role = 'admin' LIMIT 1",
    );
    const adminId = String(admins.rows[0]?.user_id);
    const other = await call("identity.user-get", { cookie, params: { userId: adminId } });
    expect(other.status).toBe(403);
  });

  it("route-level role gate: an authenticated non-admin cannot call management routes", async () => {
    const login = await call("identity.login", {
      body: { username, password: "brand-new-pass-99" },
    });
    const cookie = sessionCookie(login);
    const listing = await call("identity.user-list", { cookie });
    expect(listing.status).toBe(403);
    const creating = await call("identity.user-create", {
      cookie,
      body: {
        username: `x-${runId}`,
        displayName: "X",
        collegeId: COLLEGE,
        temporaryPassword: "temporary-pass-123",
        roles: [],
      },
    });
    expect(creating.status).toBe(403);
  });

  it("grants: add persists unverified, remove works, both audited", async () => {
    const add = await call("identity.grant-add", {
      cookie: adminCookie,
      params: { userId },
      body: {
        role: "teacher",
        collegeId: COLLEGE,
        departmentId: "dep-int",
        classId: "cls-int",
        subjectId: "sub-int",
      },
    });
    expect(add.status).toBe(201);
    const grant = (await add.json()) as { id: string; verified: boolean };
    expect(grant.verified).toBe(false);

    const remove = await call("identity.grant-remove", {
      cookie: adminCookie,
      params: { userId, grantId: grant.id },
    });
    expect(remove.status).toBe(200);
    const actions = await auditActions();
    expect(actions).toContain("identity.grant-added");
    expect(actions).toContain("identity.grant-removed");
  });

  it("role change kills the user's sessions and audits before/after", async () => {
    const login = await call("identity.login", {
      body: { username, password: "brand-new-pass-99" },
    });
    const cookie = sessionCookie(login);
    expect((await call("identity.session", { cookie })).status).toBe(200);

    const set = await call("identity.roles-set", {
      cookie: adminCookie,
      params: { userId },
      body: { roles: ["class_teacher"] },
    });
    expect(set.status).toBe(200);
    expect((await call("identity.session", { cookie })).status).toBe(401);

    const rows = await system.service.readRecentAuditEvents(20);
    const change = rows.find((row) => row.action === "identity.roles-changed");
    expect(change?.details).toMatchObject({ before: ["teacher"], after: ["class_teacher"] });
  });
});

describe("login throttling against real Redis", () => {
  it("locks the user+ip subject after repeated failures", async () => {
    const victim = `locked-${runId}`;
    const ip = "10.9.9.9";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await call("identity.login", {
        body: { username: victim, password: `wrong-${attempt}` },
        ip,
      });
      expect(response.status).toBe(401);
    }
    const fifth = await call("identity.login", {
      body: { username: victim, password: "wrong-5" },
      ip,
    });
    expect(fifth.status).toBe(429);
    expect(fifth.headers.get("retry-after")).toBe(String(15 * 60));
    const actions = await auditActions();
    expect(actions).toContain("identity.login-failed");
  });
});
