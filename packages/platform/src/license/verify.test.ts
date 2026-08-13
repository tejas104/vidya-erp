import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type LicenseClaims, verifyLicense } from "./verify";

/**
 * The verifier is pure, so these are fast unit tests against a throwaway
 * key pair generated once per test run — no fixtures on disk, nothing to
 * rot, nothing that could ever be mistaken for a real license.
 */
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

function baseClaims(overrides: Partial<LicenseClaims> = {}): LicenseClaims {
  return {
    v: 1,
    id: "lic_test_001",
    customer: "Northgate Junior College",
    edition: "college",
    issuedAt: "2026-08-13",
    expiresAt: "2027-08-13",
    seats: 500,
    ...overrides,
  };
}

/** Signs arbitrary claims (or overridden raw fields) with the given key, mirroring what scripts/license-issue.ts does. */
function issueToken(claims: unknown, key: KeyObject = privateKey): string {
  const payloadBytes = Buffer.from(JSON.stringify(claims), "utf8");
  const signatureBytes = cryptoSign(null, payloadBytes, key);
  return `${payloadBytes.toString("base64url")}.${signatureBytes.toString("base64url")}`;
}

describe("verifyLicense", () => {
  it("1. verifies a valid license and every claim survives exactly", () => {
    const claims = baseClaims();
    const token = issueToken(claims);
    const status = verifyLicense(token, publicKey, new Date("2026-09-01T00:00:00.000Z"), "college");
    expect(status.kind).toBe("valid");
    if (status.kind !== "valid") throw new Error("unreachable");
    expect(status.claims).toEqual(claims);
  });

  it("2. rejects a tampered payload as bad-signature and never returns the claims", () => {
    const token = issueToken(baseClaims());
    const dotIndex = token.indexOf(".");
    const payloadSegment = token.slice(0, dotIndex);
    const sigSegment = token.slice(dotIndex + 1);
    const tamperedBytes = Buffer.from(payloadSegment, "base64url");
    tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 0xff; // flip one byte
    const tampered = `${tamperedBytes.toString("base64url")}.${sigSegment}`;

    const status = verifyLicense(tampered, publicKey, new Date("2026-09-01T00:00:00.000Z"), "college");
    expect(status.kind).toBe("invalid");
    if (status.kind !== "invalid") throw new Error("unreachable");
    expect(status.reason).toBe("bad-signature");
    // The classic mistake: reporting failure while still handing back
    // attacker-controlled claims. Assert there is nothing claim-shaped on
    // the result at all, not just that the check failed.
    expect(status).not.toHaveProperty("claims");
  });

  it("3. rejects a license signed with a different key as bad-signature", () => {
    const { privateKey: otherPrivateKey } = generateKeyPairSync("ed25519");
    const token = issueToken(baseClaims(), otherPrivateKey);
    const status = verifyLicense(token, publicKey, new Date("2026-09-01T00:00:00.000Z"), "college");
    expect(status).toEqual({ kind: "invalid", reason: "bad-signature" });
  });

  describe("4. expiry boundary — exactly at the cutoff, not just some time later", () => {
    const claims = baseClaims({ expiresAt: "2026-08-13" });
    const token = issueToken(claims);
    const expiryBoundary = Date.parse("2026-08-14T00:00:00.000Z"); // one day after expiresAt

    it("is valid at the last millisecond of the expiresAt day", () => {
      const status = verifyLicense(token, publicKey, new Date(expiryBoundary - 1), "college");
      expect(status).toEqual({ kind: "valid", claims, daysRemaining: 1 });
    });

    it("is grace at the exact first millisecond after expiresAt (day 0 overdue)", () => {
      const status = verifyLicense(token, publicKey, new Date(expiryBoundary), "college");
      expect(status).toEqual({ kind: "grace", claims, daysOverdue: 0 });
    });

    it("is still grace at exactly the 30-day boundary", () => {
      const status = verifyLicense(
        token,
        publicKey,
        new Date(expiryBoundary + 30 * 86_400_000),
        "college",
      );
      expect(status).toEqual({ kind: "grace", claims, daysOverdue: 30 });
    });

    it("is expired one day past the grace window", () => {
      const status = verifyLicense(
        token,
        publicKey,
        new Date(expiryBoundary + 31 * 86_400_000),
        "college",
      );
      expect(status).toEqual({ kind: "expired", claims, daysOverdue: 31 });
    });
  });

  describe("5. garbage input never throws and always resolves to invalid", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const cases: Array<[string, string]> = [
      ["non-base64", "!!!not-base64!!!.also-not-base64"],
      ["missing signature segment", "justoneseg-mentnodot"],
      ["absurdly long input", "a".repeat(500_000) + "." + "b".repeat(500_000)],
    ];

    for (const [name, input] of cases) {
      it(`does not throw for: ${name}`, () => {
        expect(() => verifyLicense(input, publicKey, now, "college")).not.toThrow();
        expect(verifyLicense(input, publicKey, now, "college").kind).toBe("invalid");
      });
    }

    it("does not throw for valid base64 that decodes to non-JSON, signed for real", () => {
      const payloadBytes = Buffer.from("this is not json", "utf8");
      const signatureBytes = cryptoSign(null, payloadBytes, privateKey);
      const token = `${payloadBytes.toString("base64url")}.${signatureBytes.toString("base64url")}`;
      const status = verifyLicense(token, publicKey, now, "college");
      expect(status).toEqual({ kind: "invalid", reason: "malformed" });
    });

    it("does not throw for JSON that parses but is not an object, signed for real", () => {
      const token = issueToken(["not", "an", "object"]);
      const status = verifyLicense(token, publicKey, now, "college");
      expect(status).toEqual({ kind: "invalid", reason: "malformed" });
    });
  });

  it("6. absent license (empty string) is distinct from invalid", () => {
    const status = verifyLicense("", publicKey, new Date(), "college");
    expect(status).toEqual({ kind: "absent" });
  });

  it("7. unknown claims are ignored — forward-compatible", () => {
    const claims = baseClaims();
    const token = issueToken({ ...claims, futureField: "something not yet invented" });
    const status = verifyLicense(token, publicKey, new Date("2026-09-01T00:00:00.000Z"), "college");
    expect(status.kind).toBe("valid");
    if (status.kind !== "valid") throw new Error("unreachable");
    expect(status.claims).toEqual(claims);
    expect(status.claims).not.toHaveProperty("futureField");
  });

  it("8. an unsupported schema version is rejected cleanly, not silently accepted", () => {
    const token = issueToken({ ...baseClaims(), v: 2 });
    const status = verifyLicense(token, publicKey, new Date("2026-09-01T00:00:00.000Z"), "college");
    expect(status).toEqual({ kind: "invalid", reason: "unsupported-version" });
  });

  it("9. a validly-signed license for the wrong edition rejects as edition-mismatch, not bad-signature", () => {
    const claims = baseClaims({ edition: "school" });
    const token = issueToken(claims);
    const status = verifyLicense(token, publicKey, new Date("2026-09-01T00:00:00.000Z"), "college");
    expect(status).toEqual({ kind: "invalid", reason: "edition-mismatch" });
  });

  describe("10. missing required claims rejects and never defaults", () => {
    it("rejects a payload with no customer claim", () => {
      const { customer: _omitted, ...rest } = baseClaims();
      const token = issueToken(rest);
      const status = verifyLicense(token, publicKey, new Date("2026-09-01T00:00:00.000Z"), "college");
      expect(status).toEqual({ kind: "invalid", reason: "malformed" });
    });

    it("rejects a payload with no edition claim (does not default to the running edition)", () => {
      const { edition: _omitted, ...rest } = baseClaims();
      const token = issueToken(rest);
      const status = verifyLicense(token, publicKey, new Date("2026-09-01T00:00:00.000Z"), "college");
      expect(status).toEqual({ kind: "invalid", reason: "malformed" });
    });
  });

  it("never throws for the exact empty string edge case even with a bogus edition arg", () => {
    expect(() => verifyLicense("", publicKey, new Date(), "school")).not.toThrow();
  });
});
