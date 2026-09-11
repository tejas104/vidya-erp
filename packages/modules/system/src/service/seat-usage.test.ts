import { describe, expect, it } from "vitest";
import type { LicenseStatus } from "@vidya/platform";
import { seatOverage } from "./seat-usage";

const licensed = (seats: number, kind: "valid" | "grace" | "expired" = "valid"): LicenseStatus =>
  ({
    kind,
    claims: {
      v: 1,
      id: "lic_1",
      customer: "Northgate Junior College",
      edition: "college",
      issuedAt: "2026-01-01",
      expiresAt: "2027-01-01",
      seats,
    },
    ...(kind === "valid" ? { daysRemaining: 90 } : { daysOverdue: 3 }),
  }) as LicenseStatus;

describe("seatOverage (DECISION 3 — record and surface, never enforce)", () => {
  it("is silent below the licensed figure", () => {
    expect(seatOverage(licensed(1200), 1199)).toBeNull();
  });

  it("is silent AT the licensed figure — the ruling audits crossing it, not reaching it", () => {
    expect(seatOverage(licensed(1200), 1200)).toBeNull();
  });

  it("reports the first student over", () => {
    expect(seatOverage(licensed(1200), 1201)).toEqual({
      students: 1201,
      seats: 1200,
      licenseId: "lic_1",
    });
  });

  it("still reports on an expired licence — the count is a fact regardless of term", () => {
    expect(seatOverage(licensed(1200, "expired"), 1247)?.students).toBe(1247);
  });

  it("has nothing to compare against when there are no claims", () => {
    expect(seatOverage({ kind: "absent" }, 5000)).toBeNull();
    expect(seatOverage({ kind: "invalid", reason: "bad-signature" }, 5000)).toBeNull();
  });
});
