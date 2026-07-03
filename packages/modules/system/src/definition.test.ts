import { describe, expect, it } from "vitest";
import { STATE_CHANGING_METHODS } from "@vidya/platform";
import { systemModuleDefinition } from "./definition";

/**
 * Contract-conformance checks. Every future module should copy these
 * assertions (docs/how-to-add-a-module.md).
 */
describe("system module definition", () => {
  it("declares its table-ownership prefix", () => {
    expect(systemModuleDefinition.tablePrefix).toBe("sys_");
    expect(systemModuleDefinition.name).toBe("system");
  });

  it("versions every route under /api/v1/<module>/ (Constitution rule 5)", () => {
    for (const route of systemModuleDefinition.routes) {
      expect(route.path).toMatch(/^\/api\/v1\/system\//);
      expect(route.module).toBe("system");
    }
  });

  it("uses unique route ids", () => {
    const ids = systemModuleDefinition.routes.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("justifies every public route (Constitution rule 6)", () => {
    for (const route of systemModuleDefinition.routes) {
      if (route.auth.public) {
        expect(route.auth.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("declares an audit action on every state-changing route (Constitution rule 7)", () => {
    for (const route of systemModuleDefinition.routes) {
      if (STATE_CHANGING_METHODS.has(route.method)) {
        expect(route.audit).toBeDefined();
      }
    }
  });

  it("declares the heartbeat job on the module queue", () => {
    expect(systemModuleDefinition.jobs).toHaveLength(1);
    expect(systemModuleDefinition.jobs[0]).toMatchObject({
      name: "audit-heartbeat",
      module: "system",
    });
  });
});
