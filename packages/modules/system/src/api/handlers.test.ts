import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { createMetrics, type ReadinessCheck, type RouteContext } from "@vidya/platform";
import { createSystemHandlers, type SystemHandlerDeps } from "./handlers";

const logger = pino({ level: "silent" });

function ctx(): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal: null,
    request: { params: undefined, query: undefined, body: undefined, headers: new Headers() },
  };
}

function makeDeps(overrides: Partial<SystemHandlerDeps> = {}): SystemHandlerDeps {
  return {
    metrics: createMetrics({ serviceName: "test", defaultMetrics: false }),
    serviceVersion: "0.1.0-test",
    isDraining: () => false,
    infrastructureChecks: [],
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
