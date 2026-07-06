import { describe, expect, it } from "vitest";
import { STATE_CHANGING_METHODS } from "@vidya/platform";
import { academicYearForDate, analyticsModuleDefinition } from "./definition";

describe("analytics module definition (contract conformance)", () => {
  it("declares its table-ownership prefix", () => {
    expect(analyticsModuleDefinition.tablePrefix).toBe("anl_");
    expect(analyticsModuleDefinition.name).toBe("analytics");
  });

  it("versions every route under /api/v1/analytics/ (Constitution rule 5)", () => {
    for (const route of analyticsModuleDefinition.routes) {
      expect(route.path).toMatch(/^\/api\/v1\/analytics\//);
      expect(route.module).toBe("analytics");
    }
  });

  it("uses unique route ids and NO public routes", () => {
    const ids = analyticsModuleDefinition.routes.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const route of analyticsModuleDefinition.routes) {
      expect(route.auth.public, route.id).toBe(false);
    }
  });

  it("audits its one state-changing route and admin-gates it", () => {
    for (const route of analyticsModuleDefinition.routes) {
      if (STATE_CHANGING_METHODS.has(route.method)) {
        expect(route.id).toBe("analytics.recompute");
        expect(route.audit).toBeDefined();
        if (!route.auth.public) {
          expect(route.auth.requirement.rolesAnyOf).toEqual(["admin"]);
        }
      }
    }
  });

  it("declares the nightly rollup job", () => {
    expect(analyticsModuleDefinition.jobs.map((job) => job.name)).toEqual(["rollup-rebuild"]);
  });
});

describe("academicYearForDate", () => {
  it("rolls the academic year in June", () => {
    expect(academicYearForDate(new Date("2026-07-06T00:00:00Z"))).toBe("2026-27");
    expect(academicYearForDate(new Date("2026-05-31T00:00:00Z"))).toBe("2025-26");
    expect(academicYearForDate(new Date("2026-06-01T00:00:00Z"))).toBe("2026-27");
    expect(academicYearForDate(new Date("2030-01-15T00:00:00Z"))).toBe("2029-30");
  });
});
