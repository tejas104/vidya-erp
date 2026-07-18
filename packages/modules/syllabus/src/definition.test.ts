import { describe, expect, it } from "vitest";
import { STATE_CHANGING_METHODS } from "@vidya/platform";
import { syllabusModuleDefinition } from "./definition";

/**
 * Contract-conformance checks (docs/how-to-add-a-module.md). Every module
 * copies these assertions.
 */
describe("syllabus module definition", () => {
  it("declares its table-ownership prefix", () => {
    expect(syllabusModuleDefinition.tablePrefix).toBe("syl_");
    expect(syllabusModuleDefinition.name).toBe("syllabus");
  });

  it("versions every route under /api/v1/syllabus/ (Constitution rule 5)", () => {
    for (const route of syllabusModuleDefinition.routes) {
      expect(route.path).toMatch(/^\/api\/v1\/syllabus\//);
      expect(route.module).toBe("syllabus");
    }
  });

  it("uses unique route ids", () => {
    const ids = syllabusModuleDefinition.routes.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has NO public routes — every route requires authentication", () => {
    for (const route of syllabusModuleDefinition.routes) {
      expect(route.auth.public, route.id).toBe(false);
    }
  });

  it("justifies every public route (Constitution rule 6)", () => {
    for (const route of syllabusModuleDefinition.routes) {
      if (route.auth.public) {
        expect(route.auth.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("declares an audit action on every state-changing route (Constitution rule 7)", () => {
    for (const route of syllabusModuleDefinition.routes) {
      if (STATE_CHANGING_METHODS.has(route.method)) {
        expect(route.audit, route.id).toBeDefined();
      }
    }
  });

  it("declares no background jobs", () => {
    expect(syllabusModuleDefinition.jobs).toHaveLength(0);
  });
});
