import { describe, expect, it } from "vitest";
import { STATE_CHANGING_METHODS } from "@vidya/platform";
import { grantInputSchema, identityModuleDefinition } from "./definition";

describe("identity module definition (contract conformance)", () => {
  it("declares its table-ownership prefix", () => {
    expect(identityModuleDefinition.tablePrefix).toBe("idn_");
    expect(identityModuleDefinition.name).toBe("identity");
  });

  it("versions every route under /api/v1/identity/ (Constitution rule 5)", () => {
    for (const route of identityModuleDefinition.routes) {
      expect(route.path).toMatch(/^\/api\/v1\/identity\//);
      expect(route.module).toBe("identity");
    }
  });

  it("uses unique route ids", () => {
    const ids = identityModuleDefinition.routes.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps exactly two routes public, both with recorded justifications", () => {
    const publicRoutes = identityModuleDefinition.routes.filter((route) => route.auth.public);
    expect(publicRoutes.map((route) => route.id).sort()).toEqual([
      "identity.login",
      "identity.password-reset-confirm",
    ]);
    for (const route of publicRoutes) {
      if (route.auth.public) {
        expect(route.auth.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("requires the admin role on every management route", () => {
    const managementIds = [
      "identity.user-create",
      "identity.user-list",
      "identity.user-update",
      "identity.roles-set",
      "identity.grant-add",
      "identity.grant-remove",
      "identity.password-reset-init",
    ];
    for (const id of managementIds) {
      const route = identityModuleDefinition.routes.find((entry) => entry.id === id);
      expect(route).toBeDefined();
      if (route !== undefined && !route.auth.public) {
        expect(route.auth.requirement.rolesAnyOf).toEqual(["admin"]);
      }
    }
  });

  it("declares an audit action on every state-changing route (Constitution rule 7)", () => {
    for (const route of identityModuleDefinition.routes) {
      if (STATE_CHANGING_METHODS.has(route.method)) {
        expect(route.audit, route.id).toBeDefined();
      }
    }
  });
});

describe("grantInputSchema (mirrors the DB shape constraints)", () => {
  const base = { collegeId: "col-1", departmentId: "dep-1", classId: "cls-1" };

  it("accepts a well-formed teacher grant (class or section, subject required)", () => {
    expect(grantInputSchema.safeParse({ role: "teacher", ...base, subjectId: "sub-1" }).success).toBe(true);
    expect(
      grantInputSchema.safeParse({ role: "teacher", ...base, sectionId: "sec-1", subjectId: "sub-1" }).success,
    ).toBe(true);
  });

  it("rejects a teacher grant without subject or without class", () => {
    expect(grantInputSchema.safeParse({ role: "teacher", ...base }).success).toBe(false);
    expect(
      grantInputSchema.safeParse({ role: "teacher", collegeId: "col-1", subjectId: "sub-1" }).success,
    ).toBe(false);
  });

  it("accepts class_teacher without subject and rejects it with one", () => {
    expect(grantInputSchema.safeParse({ role: "class_teacher", ...base }).success).toBe(true);
    expect(
      grantInputSchema.safeParse({ role: "class_teacher", ...base, subjectId: "sub-1" }).success,
    ).toBe(false);
  });

  it("constrains hod to exactly a department", () => {
    expect(
      grantInputSchema.safeParse({ role: "hod", collegeId: "col-1", departmentId: "dep-1" }).success,
    ).toBe(true);
    expect(grantInputSchema.safeParse({ role: "hod", collegeId: "col-1" }).success).toBe(false);
    expect(grantInputSchema.safeParse({ role: "hod", ...base }).success).toBe(false);
  });

  it("constrains principal and admin to college level", () => {
    expect(grantInputSchema.safeParse({ role: "principal", collegeId: "col-1" }).success).toBe(true);
    expect(grantInputSchema.safeParse({ role: "admin", collegeId: "col-1" }).success).toBe(true);
    expect(
      grantInputSchema.safeParse({ role: "admin", collegeId: "col-1", departmentId: "dep-1" }).success,
    ).toBe(false);
  });

  it("enforces org-path nesting (section→class→department)", () => {
    expect(
      grantInputSchema.safeParse({
        role: "teacher",
        collegeId: "col-1",
        classId: "cls-1",
        subjectId: "sub-1",
      }).success,
    ).toBe(false); // class without department
    expect(
      grantInputSchema.safeParse({
        role: "class_teacher",
        collegeId: "col-1",
        departmentId: "dep-1",
        sectionId: "sec-1",
      }).success,
    ).toBe(false); // section without class
  });
});
