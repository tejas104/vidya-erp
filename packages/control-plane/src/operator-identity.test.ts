import { describe, expect, it } from "vitest";
import { assuredOperatorIdentity, isAssuredOperatorIdentity } from "./operator-identity";

const now = new Date("2026-09-26T12:00:00.000Z");
const policy = { issuer: "https://login.example.test/vidya", requiredAcr: "vidya:mfa", maxAuthAgeSeconds: 3600 };
const claims = { iss: policy.issuer, sub: "stable-operator-subject", acr: policy.requiredAcr,
  auth_time: Math.floor(now.getTime() / 1000) - 60, email: "operator@vidya.test" };

describe("operator identity assurance after verified OIDC login", () => {
  it("binds a fresh MFA identity to issuer and subject rather than email", () => {
    const identity = assuredOperatorIdentity(claims, policy, now);
    expect(identity).toEqual({
      issuer: policy.issuer, subject: claims.sub,
    });
    expect(isAssuredOperatorIdentity(identity)).toBe(true);
    expect(isAssuredOperatorIdentity({ issuer: policy.issuer, subject: claims.sub })).toBe(false);
  });

  it("fails closed for missing MFA assurance, wrong issuer and stale authentication", () => {
    for (const bad of [
      { ...claims, acr: undefined }, { ...claims, acr: "password-only" },
      { ...claims, iss: "https://other.example.test/vidya" },
      { ...claims, auth_time: claims.auth_time - 3601 },
      { ...claims, auth_time: Math.floor(now.getTime() / 1000) + 61 },
      { ...claims, sub: " stable-operator-subject" },
    ]) {
      expect(() => assuredOperatorIdentity(bad, policy, now)).toThrow("operator identity assurance failed");
    }
    expect(() => assuredOperatorIdentity(claims, { ...policy, requiredAcr: "" }, now)).toThrow();
  });
});
