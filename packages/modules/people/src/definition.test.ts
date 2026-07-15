import { describe, expect, it } from "vitest";
import { STATE_CHANGING_METHODS } from "@vidya/platform";
import { peopleModuleDefinition } from "./definition";

describe("people module definition (contract conformance)", () => {
  it("declares its table-ownership prefix", () => {
    expect(peopleModuleDefinition.tablePrefix).toBe("ppl_");
    expect(peopleModuleDefinition.name).toBe("people");
  });

  it("versions every route under /api/v1/people/ (Constitution rule 5)", () => {
    for (const route of peopleModuleDefinition.routes) {
      expect(route.path).toMatch(/^\/api\/v1\/people\//);
      expect(route.module).toBe("people");
    }
  });

  it("uses unique route ids", () => {
    const ids = peopleModuleDefinition.routes.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has NO public routes — people data always requires authentication", () => {
    for (const route of peopleModuleDefinition.routes) {
      expect(route.auth.public, route.id).toBe(false);
    }
  });

  it("declares an audit action on every state-changing route (Constitution rule 7)", () => {
    for (const route of peopleModuleDefinition.routes) {
      if (STATE_CHANGING_METHODS.has(route.method)) {
        expect(route.audit, route.id).toBeDefined();
      }
    }
  });

  it("gates writes on admin; the class teacher is a scoped sub-admin over student add/edit/enroll (2.4)", () => {
    // The ScopeChecker enforces the section for these; the role gate only
    // mirrors who could ever pass (scope-traces cover the section boundary).
    const CLASS_TEACHER_WRITABLE = new Set([
      "people.student-create",
      "people.student-update",
      "people.student-enroll",
      "people.document-upload",
      "people.document-delete",
    ]);
    for (const route of peopleModuleDefinition.routes) {
      if (!STATE_CHANGING_METHODS.has(route.method) || route.auth.public) {
        continue;
      }
      const roles = route.auth.requirement.rolesAnyOf ?? [];
      expect(roles, route.id).toContain("admin");
      if (CLASS_TEACHER_WRITABLE.has(route.id)) {
        expect(roles, route.id).toEqual(["admin", "class_teacher"]);
      } else {
        expect(roles, route.id).toEqual(["admin"]);
      }
    }
  });

  it("assignment body schema enforces the subject/kind shape", () => {
    const route = peopleModuleDefinition.routes.find(
      (entry) => entry.id === "people.assignment-create",
    );
    const schema = route?.request?.body;
    expect(schema).toBeDefined();
    const base = { classId: "cls_1", academicYear: "2026-27" };
    expect(schema!.safeParse({ ...base, kind: "subject_teacher", subjectId: "sub_1" }).success).toBe(true);
    expect(schema!.safeParse({ ...base, kind: "subject_teacher" }).success).toBe(false);
    expect(schema!.safeParse({ ...base, kind: "class_teacher" }).success).toBe(true);
    expect(schema!.safeParse({ ...base, kind: "class_teacher", subjectId: "sub_1" }).success).toBe(false);
    expect(schema!.safeParse({ ...base, kind: "subject_teacher", subjectId: "sub_1", academicYear: "26-27" }).success).toBe(false);
  });

  it("declares the two jobs (import + reconcile)", () => {
    expect(peopleModuleDefinition.jobs.map((job) => job.name).sort()).toEqual([
      "bulk-import",
      "grant-reconcile",
    ]);
  });
});
