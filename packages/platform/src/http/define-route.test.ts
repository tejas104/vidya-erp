import { describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import { z } from "zod";
import type {
  AccessPolicy,
  Authenticator,
  Principal,
} from "../auth/types";
import type { AuditEvent, AuditLogger } from "../audit/types";
import { DenyAllAccessPolicy, DenyAllAuthenticator } from "../auth/deny-all";
import { createMetrics } from "../metrics/metrics";
import type { RouteHandler, RouteSpec } from "../contracts/module";
import { defineRoute, type RouteDependencies } from "./define-route";

const silentLogger = pino({ level: "silent" });

const testPrincipal: Principal = {
  id: "user-1",
  kind: "user",
  displayName: "Test User",
  roles: ["registrar"],
  scopes: ["attendance:write"],
  sessionId: "sess-1",
};

const allowAuthenticator: Authenticator = {
  authenticate: async () => ({ authenticated: true, principal: testPrincipal }),
};

const allowPolicy: AccessPolicy = {
  authorize: async () => ({ granted: true }),
};

class RecordingAuditLogger implements AuditLogger {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

function makeDeps(overrides: Partial<RouteDependencies> = {}): RouteDependencies & {
  audit: RecordingAuditLogger;
} {
  const audit = new RecordingAuditLogger();
  return {
    logger: silentLogger,
    authenticator: new DenyAllAuthenticator(),
    accessPolicy: new DenyAllAccessPolicy(),
    auditLogger: audit,
    metrics: createMetrics({ serviceName: "test", defaultMetrics: false }),
    audit,
    ...overrides,
  };
}

function makeSpec(overrides: Partial<RouteSpec> = {}): RouteSpec {
  return {
    id: "demo.get",
    module: "demo",
    method: "GET",
    path: "/api/v1/demo",
    summary: "demo route",
    tags: ["demo"],
    auth: { public: false, requirement: {} },
    responses: { 200: { description: "ok" } },
    ...overrides,
  };
}

const okHandler: RouteHandler = async () => ({ status: 200, body: { ok: true } });

function get(url = "http://localhost/api/v1/demo", headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("defineRoute — authentication gate (deny-by-default)", () => {
  it("returns 401 problem+json with a challenge on non-public routes when unauthenticated", async () => {
    const handler = defineRoute(makeSpec(), okHandler, makeDeps());
    const response = await handler(get());
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    const body = (await response.json()) as { status: number; requestId: string };
    expect(body.status).toBe(401);
    expect(body.requestId).toBeTruthy();
  });

  it("never calls the authenticator on public routes", async () => {
    const authenticate = vi.fn();
    const deps = makeDeps({
      authenticator: { authenticate } as unknown as Authenticator,
    });
    const spec = makeSpec({ auth: { public: true, reason: "liveness probe" } });
    const response = await defineRoute(spec, okHandler, deps)(get());
    expect(response.status).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated but the access policy denies", async () => {
    const deps = makeDeps({ authenticator: allowAuthenticator });
    const response = await defineRoute(makeSpec(), okHandler, deps)(get());
    expect(response.status).toBe(403);
  });

  it("passes principal, requirement and context to the access policy (the #2 scope-check seam)", async () => {
    const authorize = vi.fn(async () => ({ granted: true }) as const);
    const requirement = { rolesAnyOf: ["registrar"], scopesAllOf: ["attendance:write"] };
    const deps = makeDeps({
      authenticator: allowAuthenticator,
      accessPolicy: { authorize },
    });
    const spec = makeSpec({ auth: { public: false, requirement } });
    let seenPrincipal: Principal | null = null;
    const handler: RouteHandler = async (ctx) => {
      seenPrincipal = ctx.principal;
      return { status: 200 };
    };
    const response = await defineRoute(spec, handler, deps)(get());
    expect(response.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith(
      testPrincipal,
      requirement,
      expect.objectContaining({ module: "demo", routeId: "demo.get" }),
    );
    expect(seenPrincipal).toEqual(testPrincipal);
  });
});

describe("defineRoute — request correlation", () => {
  it("echoes a well-formed x-request-id", async () => {
    const spec = makeSpec({ auth: { public: true, reason: "test" } });
    const response = await defineRoute(spec, okHandler, makeDeps())(
      get(undefined, { "x-request-id": "trace-42" }),
    );
    expect(response.headers.get("x-request-id")).toBe("trace-42");
  });

  it("mints a UUID when the supplied id is malformed", async () => {
    const spec = makeSpec({ auth: { public: true, reason: "test" } });
    const response = await defineRoute(spec, okHandler, makeDeps())(
      get(undefined, { "x-request-id": "bad id with spaces" }),
    );
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("defineRoute — validation", () => {
  it("rejects invalid query parameters with a 400 and issue paths", async () => {
    const spec = makeSpec({
      auth: { public: true, reason: "test" },
      request: { query: z.object({ limit: z.coerce.number().int().min(1) }) },
    });
    const response = await defineRoute(spec, okHandler, makeDeps())(
      get("http://localhost/api/v1/demo?limit=zero"),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { path: string }[] };
    expect(body.issues[0]?.path).toBe("limit");
  });

  it("passes validated query values to the handler", async () => {
    const spec = makeSpec({
      auth: { public: true, reason: "test" },
      request: { query: z.object({ limit: z.coerce.number() }) },
    });
    let seen: unknown;
    const handler: RouteHandler = async (ctx) => {
      seen = ctx.request.query;
      return { status: 200 };
    };
    await defineRoute(spec, handler, makeDeps())(get("http://localhost/api/v1/demo?limit=5"));
    expect(seen).toEqual({ limit: 5 });
  });

  it("rejects a non-JSON body with 400", async () => {
    const spec = makeSpec({
      method: "POST",
      audit: { action: "demo.create", resourceType: "demo" },
      auth: { public: true, reason: "test" },
      request: { body: z.object({ name: z.string() }) },
    });
    const response = await defineRoute(spec, okHandler, makeDeps())(
      new Request("http://localhost/api/v1/demo", { method: "POST", body: "not-json" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a schema-invalid body with 400 and validates a good one", async () => {
    const spec = makeSpec({
      method: "POST",
      audit: { action: "demo.create", resourceType: "demo" },
      auth: { public: true, reason: "test" },
      request: { body: z.object({ name: z.string().min(1) }) },
    });
    const bound = defineRoute(spec, okHandler, makeDeps());
    const bad = await bound(
      new Request("http://localhost/api/v1/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      }),
    );
    expect(bad.status).toBe(400);
    const good = await bound(
      new Request("http://localhost/api/v1/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "ok" }),
      }),
    );
    expect(good.status).toBe(200);
  });
});

describe("defineRoute — audit (Constitution rule 7)", () => {
  it("refuses to build a state-changing route without an audit declaration", () => {
    const spec = makeSpec({ method: "POST", audit: undefined });
    expect(() => defineRoute(spec, okHandler, makeDeps())).toThrow(/audit/);
  });

  it("records an audit event on successful state changes, with handler-contributed fields", async () => {
    const deps = makeDeps({ authenticator: allowAuthenticator, accessPolicy: allowPolicy });
    const spec = makeSpec({
      method: "POST",
      audit: { action: "demo.create", resourceType: "demo" },
    });
    const handler: RouteHandler = async () => ({
      status: 201,
      body: { id: "d-1" },
      audit: { resourceId: "d-1", details: { source: "test" } },
    });
    const response = await defineRoute(spec, handler, deps)(
      new Request("http://localhost/api/v1/demo", { method: "POST" }),
    );
    expect(response.status).toBe(201);
    expect(deps.audit.events).toHaveLength(1);
    expect(deps.audit.events[0]).toMatchObject({
      module: "demo",
      action: "demo.create",
      actorType: "user",
      actorId: "user-1",
      resourceType: "demo",
      resourceId: "d-1",
      details: expect.objectContaining({ source: "test", status: 201 }),
    });
  });

  it("does not audit failed state changes", async () => {
    const deps = makeDeps({ authenticator: allowAuthenticator, accessPolicy: allowPolicy });
    const spec = makeSpec({
      method: "POST",
      audit: { action: "demo.create", resourceType: "demo" },
    });
    const handler: RouteHandler = async () => ({ status: 422, body: {} });
    await defineRoute(spec, handler, deps)(
      new Request("http://localhost/api/v1/demo", { method: "POST" }),
    );
    expect(deps.audit.events).toHaveLength(0);
  });

  it("fails the request (500) when the audit write fails — fail-closed", async () => {
    const failingAudit: AuditLogger = {
      record: async () => {
        throw new Error("audit store unavailable");
      },
    };
    const deps = makeDeps({
      authenticator: allowAuthenticator,
      accessPolicy: allowPolicy,
      auditLogger: failingAudit,
    });
    const spec = makeSpec({
      method: "POST",
      audit: { action: "demo.create", resourceType: "demo" },
    });
    const response = await defineRoute(spec, okHandler, deps)(
      new Request("http://localhost/api/v1/demo", { method: "POST" }),
    );
    expect(response.status).toBe(500);
  });

  it("does not audit reads", async () => {
    const deps = makeDeps({ authenticator: allowAuthenticator, accessPolicy: allowPolicy });
    await defineRoute(makeSpec(), okHandler, deps)(get());
    expect(deps.audit.events).toHaveLength(0);
  });
});

describe("defineRoute — errors, content types, metrics", () => {
  it("maps handler exceptions to an opaque 500 problem", async () => {
    const spec = makeSpec({ auth: { public: true, reason: "test" } });
    const handler: RouteHandler = async () => {
      throw new Error("secret internal detail");
    };
    const response = await defineRoute(spec, handler, makeDeps())(get());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("secret internal detail");
  });

  it("supports non-JSON responses via contentType", async () => {
    const spec = makeSpec({ auth: { public: true, reason: "test" } });
    const handler: RouteHandler = async () => ({
      status: 200,
      body: "metric_value 1",
      contentType: "text/plain; version=0.0.4",
    });
    const response = await defineRoute(spec, handler, makeDeps())(get());
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("metric_value 1");
  });

  it("records request metrics with terminal status labels", async () => {
    const deps = makeDeps();
    const spec = makeSpec(); // non-public → 401 via deny-all
    await defineRoute(spec, okHandler, deps)(get());
    const counter = await deps.metrics.httpRequestsTotal.get();
    const sample = counter.values.find((value) => value.labels.status === "401");
    expect(sample?.value).toBe(1);
    expect(sample?.labels).toMatchObject({ module: "demo", route: "demo.get", method: "GET" });
  });
});
