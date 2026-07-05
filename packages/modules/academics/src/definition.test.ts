import { describe, expect, it } from "vitest";
import { STATE_CHANGING_METHODS } from "@vidya/platform";
import { academicsModuleDefinition } from "./definition";

describe("academics module definition (contract conformance)", () => {
  it("declares its table-ownership prefix", () => {
    expect(academicsModuleDefinition.tablePrefix).toBe("acd_");
    expect(academicsModuleDefinition.name).toBe("academics");
  });

  it("versions every route under /api/v1/academics/ (Constitution rule 5)", () => {
    for (const route of academicsModuleDefinition.routes) {
      expect(route.path).toMatch(/^\/api\/v1\/academics\//);
      expect(route.module).toBe("academics");
    }
  });

  it("uses unique route ids", () => {
    const ids = academicsModuleDefinition.routes.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has NO public routes — academic data always requires authentication", () => {
    for (const route of academicsModuleDefinition.routes) {
      expect(route.auth.public, route.id).toBe(false);
    }
  });

  it("declares an audit action on every state-changing route (Constitution rule 7)", () => {
    for (const route of academicsModuleDefinition.routes) {
      if (STATE_CHANGING_METHODS.has(route.method)) {
        expect(route.audit, route.id).toBeDefined();
      }
    }
  });

  it("role-gates writes per the matrix: attendance→class_teacher, marks→teacher", () => {
    for (const route of academicsModuleDefinition.routes) {
      if (!STATE_CHANGING_METHODS.has(route.method) || route.auth.public) {
        continue;
      }
      const roles = route.auth.requirement.rolesAnyOf ?? [];
      if (route.id.startsWith("academics.attendance-")) {
        expect(roles, route.id).toEqual(["class_teacher"]);
      } else {
        expect(roles, route.id).toEqual(["teacher"]);
      }
    }
  });

  it("declares the daily gap-scan job", () => {
    expect(academicsModuleDefinition.jobs.map((job) => job.name)).toEqual([
      "attendance-gap-scan",
    ]);
  });
});
