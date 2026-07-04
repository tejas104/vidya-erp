import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { Counter, Registry } from "prom-client";
import type {
  Principal,
  RouteContext,
  ScopeChecker,
  ScopeDecision,
} from "@vidya/platform";
import { createIdentityHandlers, type IdentityHandlerDeps } from "./handlers";
import { AuthService } from "../service/auth-service";
import { UsersService } from "../service/users-service";
import { FailureThrottle } from "../service/throttle";
import {
  FakePasswordHasher,
  FakeResetTokensRepo,
  FakeSessionManager,
  FakeUsersRepo,
  MemoryThrottleStore,
  RecordingAudit,
} from "../../test-support/fakes";

const logger = pino({ level: "silent" });

/** TEST DOUBLE — configurable decisions; the real checker is human-owned. */
class StubScopeChecker implements ScopeChecker {
  decision: ScopeDecision = { granted: true, reason: "stub-allow" };
  lastArgs: unknown[] = [];
  check(...args: unknown[]): ScopeDecision {
    this.lastArgs = args;
    return this.decision;
  }
}

function makeHarness() {
  const repo = new FakeUsersRepo();
  const resetTokens = new FakeResetTokensRepo();
  const hasher = new FakePasswordHasher();
  const sessions = new FakeSessionManager();
  const audit = new RecordingAudit();
  const store = new MemoryThrottleStore();
  const scopeChecker = new StubScopeChecker();
  const users = new UsersService({ repo, hasher, sessions, audit });
  const auth = new AuthService({
    repo,
    resetTokens,
    hasher,
    sessions,
    audit,
    loginThrottle: new FailureThrottle(store, { maxAttempts: 3, windowMinutes: 15 }, "login"),
    resetThrottle: new FailureThrottle(store, { maxAttempts: 3, windowMinutes: 15 }, "reset"),
    resetTokenTtlMinutes: 30,
  });
  const deps: IdentityHandlerDeps = {
    users,
    auth,
    scopeChecker,
    cookiePolicy: { name: "vidya_session", secure: true },
    loginsTotal: new Counter({
      name: "vidya_logins_total",
      help: "test",
      labelNames: ["outcome"],
      registers: [new Registry()],
    }),
    throttleWindowMinutes: 15,
  };
  return { handlers: createIdentityHandlers(deps), repo, scopeChecker, audit, sessions };
}

const adminPrincipal: Principal = {
  id: "admin-1",
  kind: "user",
  displayName: "Admin",
  roles: ["admin"],
  scopes: [],
  grants: [{ role: "admin", org: { collegeId: "col-1" } }],
  sessionId: "sess-admin",
};

function ctx(input: {
  principal?: Principal | null;
  body?: unknown;
  params?: unknown;
  query?: unknown;
  headers?: Record<string, string>;
}): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal: input.principal ?? null,
    request: {
      params: input.params,
      query: input.query,
      body: input.body,
      headers: new Headers(input.headers ?? {}),
    },
  };
}

describe("identity.login handler", () => {
  it("sets the hardened session cookie and overrides the audit actor on success", async () => {
    const { handlers, repo } = makeHarness();
    const user = repo.seed({ username: "asha", passwordHash: "fake-hash::pw-value-1::s", status: "active" });
    const result = await handlers["identity.login"]!(
      ctx({ body: { username: "asha", password: "pw-value-1" }, headers: { "x-forwarded-for": "10.0.0.9" } }),
    );
    expect(result.status).toBe(200);
    expect(result.headers?.["set-cookie"]).toContain("vidya_session=");
    expect(result.headers?.["set-cookie"]).toContain("HttpOnly");
    expect(result.headers?.["cache-control"]).toBe("no-store");
    expect(result.audit?.actor).toEqual({ type: "user", id: user.id });
    expect(result.audit?.resourceId).toMatch(/^sess-/);
  });

  it("maps outcomes to 401, 403 and 429 (with retry-after)", async () => {
    const { handlers, repo } = makeHarness();
    repo.seed({ username: "newbie", passwordHash: "fake-hash::temp::s", status: "must_reset" });
    const bad = await handlers["identity.login"]!(ctx({ body: { username: "asha", password: "nope" } }));
    expect(bad.status).toBe(401);
    const reset = await handlers["identity.login"]!(ctx({ body: { username: "newbie", password: "temp" } }));
    expect(reset.status).toBe(403);
    await handlers["identity.login"]!(ctx({ body: { username: "x", password: "1" } }));
    await handlers["identity.login"]!(ctx({ body: { username: "x", password: "2" } }));
    const locked = await handlers["identity.login"]!(ctx({ body: { username: "x", password: "3" } }));
    expect(locked.status).toBe(429);
    expect(locked.headers?.["retry-after"]).toBe(String(15 * 60));
  });
});

describe("identity.logout / session handlers", () => {
  it("invalidates the session and clears the cookie", async () => {
    const { handlers, sessions } = makeHarness();
    const issued = await sessions.issue({ userId: "u1", displayName: "U", roles: [], grants: [] });
    const principal: Principal = { ...adminPrincipal, id: "u1", sessionId: issued.sessionId };
    const result = await handlers["identity.logout"]!(ctx({ principal }));
    expect(result.status).toBe(200);
    expect(result.headers?.["set-cookie"]).toContain("Max-Age=0");
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  it("whoami reflects the principal snapshot", async () => {
    const { handlers } = makeHarness();
    const result = await handlers["identity.session"]!(ctx({ principal: adminPrincipal }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ userId: "admin-1", roles: ["admin"] });
  });
});

describe("scope-check chokepoint usage", () => {
  it("denies user-create with 403 when the scope-check denies, before any write", async () => {
    const { handlers, scopeChecker, repo } = makeHarness();
    scopeChecker.decision = { granted: false, reason: "outside admin scope" };
    const result = await handlers["identity.user-create"]!(
      ctx({
        principal: adminPrincipal,
        body: {
          username: "new-user",
          displayName: "New",
          collegeId: "col-2",
          temporaryPassword: "temporary-pass-1",
          roles: [],
        },
      }),
    );
    expect(result.status).toBe(403);
    expect(repo.byId.size).toBe(0);
  });

  it("user-get consults the checker with owner + org so self-access can apply", async () => {
    const { handlers, scopeChecker, repo } = makeHarness();
    const target = repo.seed({ username: "someone", passwordHash: "h", collegeId: "col-9" });
    await handlers["identity.user-get"]!(
      ctx({ principal: adminPrincipal, params: { userId: target.id } }),
    );
    expect(scopeChecker.lastArgs[1]).toBe("read");
    expect(scopeChecker.lastArgs[2]).toMatchObject({
      module: "identity",
      resourceType: "user-profile",
      org: { collegeId: "col-9" },
      ownerUserId: target.id,
    });
  });

  it("user-get returns 404 for unknown users without consulting the checker", async () => {
    const { handlers, scopeChecker } = makeHarness();
    const result = await handlers["identity.user-get"]!(
      ctx({ principal: adminPrincipal, params: { userId: "ghost" } }),
    );
    expect(result.status).toBe(404);
    expect(scopeChecker.lastArgs).toHaveLength(0);
  });
});

describe("admin management handlers", () => {
  it("user-create maps duplicate usernames to 409", async () => {
    const { handlers, repo } = makeHarness();
    repo.seed({ username: "taken", passwordHash: "h" });
    const result = await handlers["identity.user-create"]!(
      ctx({
        principal: adminPrincipal,
        body: {
          username: "taken",
          displayName: "Dup",
          collegeId: "col-1",
          temporaryPassword: "temporary-pass-1",
          roles: [],
        },
      }),
    );
    expect(result.status).toBe(409);
  });

  it("roles-set reports before/after in its audit contribution", async () => {
    const { handlers, repo } = makeHarness();
    const user = repo.seed({ username: "asha", passwordHash: "h", roles: ["teacher"] });
    const result = await handlers["identity.roles-set"]!(
      ctx({ principal: adminPrincipal, params: { userId: user.id }, body: { roles: ["hod"] } }),
    );
    expect(result.status).toBe(200);
    expect(result.audit?.details).toEqual({ before: ["teacher"], after: ["hod"] });
  });

  it("grant-add maps a role-not-held violation to 409", async () => {
    const { handlers, repo } = makeHarness();
    const user = repo.seed({ username: "asha", passwordHash: "h", roles: ["teacher"] });
    const result = await handlers["identity.grant-add"]!(
      ctx({
        principal: adminPrincipal,
        params: { userId: user.id },
        body: { role: "hod", collegeId: "col-1", departmentId: "dep-1" },
      }),
    );
    expect(result.status).toBe(409);
  });

  it("password-reset-init returns the token once and never audits it", async () => {
    const { handlers, repo } = makeHarness();
    const user = repo.seed({ username: "asha", passwordHash: "h" });
    const result = await handlers["identity.password-reset-init"]!(
      ctx({ principal: adminPrincipal, params: { userId: user.id } }),
    );
    expect(result.status).toBe(201);
    const token = (result.body as { token: string }).token;
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(JSON.stringify(result.audit)).not.toContain(token);
    expect(result.headers?.["cache-control"]).toBe("no-store");
  });
});
