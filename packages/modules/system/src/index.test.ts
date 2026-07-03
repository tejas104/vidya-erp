import { describe, expect, it, vi } from "vitest";
import { createMetrics, type Db } from "@vidya/platform";
import { createSystemModule, systemModuleDefinition } from "./index";

function makeModule() {
  const values = vi.fn(async () => undefined);
  const db = { insert: vi.fn(() => ({ values })) } as unknown as Db;
  const module = createSystemModule({
    db,
    metrics: createMetrics({ serviceName: "test", defaultMetrics: false }),
    serviceVersion: "0.1.0-test",
    isDraining: () => false,
    infrastructureChecks: [],
  });
  return { module, values };
}

describe("createSystemModule", () => {
  it("returns a fully wired runtime module for the published definition", () => {
    const { module } = makeModule();
    expect(module.definition).toBe(systemModuleDefinition);
    expect(Object.keys(module.handlers).sort()).toEqual([
      "system.health",
      "system.metrics",
      "system.ready",
    ]);
    expect(Object.keys(module.jobProcessors)).toEqual(["audit-heartbeat"]);
  });

  it("exposes the audit seam through its public service API", async () => {
    const { module, values } = makeModule();
    await module.service.audit.record({
      module: "system",
      action: "system.test",
      actorType: "system",
      actorId: null,
      resourceType: "test",
      resourceId: null,
      requestId: null,
      details: {},
    });
    expect(values).toHaveBeenCalledTimes(1);
  });
});
