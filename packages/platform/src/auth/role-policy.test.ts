import { describe, expect, it } from "vitest";
import type { Principal } from "./types";
import { RoleRequirementPolicy } from "./role-policy";

const policy = new RoleRequirementPolicy();

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: "u1",
    kind: "user",
    displayName: "U",
    roles: ["teacher"],
    scopes: [],
    grants: [],
    sessionId: "s1",
    ...overrides,
  };
}

describe("RoleRequirementPolicy", () => {
  it("grants when no requirement is declared (any authenticated staff principal)", async () => {
    expect((await policy.authorize(principal(), {})).granted).toBe(true);
    expect(
      (await policy.authorize(principal(), { rolesAnyOf: [], scopesAllOf: [] })).granted,
    ).toBe(true);
  });

  it("grants when the principal holds one of the required roles", async () => {
    const decision = await policy.authorize(principal({ roles: ["teacher", "hod"] }), {
      rolesAnyOf: ["admin", "hod"],
    });
    expect(decision.granted).toBe(true);
  });

  it("denies with a reason when no required role is held", async () => {
    const decision = await policy.authorize(principal(), { rolesAnyOf: ["admin"] });
    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.reason).toContain("admin");
    }
  });

  it("denies when any required coarse scope is missing", async () => {
    const decision = await policy.authorize(principal({ scopes: ["a"] }), {
      scopesAllOf: ["a", "b"],
    });
    expect(decision.granted).toBe(false);
  });

  it("enforces roles and scopes together", async () => {
    const decision = await policy.authorize(
      principal({ roles: ["admin"], scopes: ["a", "b"] }),
      { rolesAnyOf: ["admin"], scopesAllOf: ["a", "b"] },
    );
    expect(decision.granted).toBe(true);
  });

  it("has no implicit role hierarchy (admin does not satisfy a teacher requirement)", async () => {
    const decision = await policy.authorize(principal({ roles: ["admin"] }), {
      rolesAnyOf: ["teacher"],
    });
    expect(decision.granted).toBe(false);
  });

  describe("audience (ADR-0027)", () => {
    const guardian = principal({ kind: "guardian", roles: [], grants: [] });

    it("refuses a guardian on a route with an empty requirement", async () => {
      expect(await policy.authorize(guardian, {})).toEqual({ granted: false, reason: "route audience is staff" });
    });

    it("refuses a guardian on an explicitly staff route, whatever its role list", async () => {
      expect((await policy.authorize(guardian, { audience: "staff" })).granted).toBe(false);
      expect((await policy.authorize(guardian, { rolesAnyOf: [] })).granted).toBe(false);
    });

    it("admits a guardian only on a guardian-audience route", async () => {
      expect((await policy.authorize(guardian, { audience: "guardian" })).granted).toBe(true);
    });

    it("admits every principal kind on an \"any\" route (session self-service only)", async () => {
      expect((await policy.authorize(guardian, { audience: "any" })).granted).toBe(true);
      expect((await policy.authorize(principal(), { audience: "any" })).granted).toBe(true);
    });

    it("refuses staff and service principals on a guardian-audience route", async () => {
      expect((await policy.authorize(principal({ roles: ["admin"] }), { audience: "guardian" })).granted).toBe(false);
      expect((await policy.authorize(principal({ kind: "service", roles: [] }), { audience: "guardian" })).granted).toBe(false);
    });
  });
});
