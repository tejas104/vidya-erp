import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertModuleWiring,
  type ModuleDefinition,
  type RuntimeModule,
} from "./module";

const definition: ModuleDefinition = {
  name: "demo",
  tablePrefix: "demo_",
  migrationsDir: "migrations",
  routes: [
    {
      id: "demo.ping",
      module: "demo",
      method: "GET",
      path: "/api/v1/demo/ping",
      summary: "ping",
      tags: ["demo"],
      auth: { public: false, requirement: {} },
      responses: { 200: { description: "ok" } },
    },
  ],
  jobs: [
    { name: "tick", module: "demo", summary: "tick", payloadSchema: z.object({}) },
  ],
};

function runtime(overrides: Partial<RuntimeModule>): RuntimeModule {
  return {
    definition,
    handlers: { "demo.ping": async () => ({ status: 200 }) },
    jobProcessors: { tick: async () => undefined },
    readinessChecks: [],
    service: {},
    ...overrides,
  };
}

describe("assertModuleWiring", () => {
  it("accepts a fully wired module", () => {
    expect(() => assertModuleWiring(runtime({}))).not.toThrow();
  });

  it("rejects a route without a handler", () => {
    expect(() => assertModuleWiring(runtime({ handlers: {} }))).toThrow(/no handler/);
  });

  it("rejects a handler without a route spec", () => {
    expect(() =>
      assertModuleWiring(
        runtime({
          handlers: {
            "demo.ping": async () => ({ status: 200 }),
            "demo.ghost": async () => ({ status: 200 }),
          },
        }),
      ),
    ).toThrow(/no route spec/);
  });

  it("rejects a job without a processor", () => {
    expect(() => assertModuleWiring(runtime({ jobProcessors: {} }))).toThrow(/no processor/);
  });

  it("rejects a processor without a job spec", () => {
    expect(() =>
      assertModuleWiring(
        runtime({
          jobProcessors: {
            tick: async () => undefined,
            ghost: async () => undefined,
          },
        }),
      ),
    ).toThrow(/no job spec/);
  });
});
