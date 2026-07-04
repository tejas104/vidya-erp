import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "../contracts";

/**
 * CONFORMANCE SUITE — PasswordHasher (Fable-authored acceptance harness for
 * the HUMAN-OWNED implementation). Invoke from the implementation's test
 * file:
 *
 *   describePasswordHasherConformance("argon2 hasher", () => createHasher());
 *
 * Passing this suite is necessary, not sufficient: a human must also have
 * read and understood the implementation (assignment #2 acceptance rule).
 */
export function describePasswordHasherConformance(
  name: string,
  create: () => PasswordHasher,
): void {
  describe(`PasswordHasher conformance: ${name}`, () => {
    it("verifies a hashed password and rejects a wrong one", async () => {
      const hasher = create();
      const hash = await hasher.hash("correct horse battery staple");
      expect(await hasher.verify(hash, "correct horse battery staple")).toBe(true);
      expect(await hasher.verify(hash, "correct horse battery stapl")).toBe(false);
      expect(await hasher.verify(hash, "")).toBe(false);
    });

    it("salts: hashing the same password twice yields different hashes", async () => {
      const hasher = create();
      const first = await hasher.hash("repeat-me-please-12");
      const second = await hasher.hash("repeat-me-please-12");
      expect(first).not.toBe(second);
      expect(await hasher.verify(first, "repeat-me-please-12")).toBe(true);
      expect(await hasher.verify(second, "repeat-me-please-12")).toBe(true);
    });

    it("never stores the password recoverably in the hash string", async () => {
      const hasher = create();
      const password = "S3ns1tive-Passphrase-Value";
      const hash = await hasher.hash(password);
      expect(hash).not.toContain(password);
      expect(hash.length).toBeGreaterThanOrEqual(32);
    });

    it("handles unicode and maximum-length passwords", async () => {
      const hasher = create();
      const unicode = "pässwörd-😀-ünïcodé-12";
      expect(await hasher.verify(await hasher.hash(unicode), unicode)).toBe(true);
      const long = "x".repeat(256);
      expect(await hasher.verify(await hasher.hash(long), long)).toBe(true);
      expect(await hasher.verify(await hasher.hash(long), `${long}y`)).toBe(false);
    });

    it("returns false (never throws) for malformed stored hashes", async () => {
      const hasher = create();
      expect(await hasher.verify("not-a-real-hash", "anything")).toBe(false);
      expect(await hasher.verify("", "anything")).toBe(false);
    });

    it("provides a dummyHash that verifies nothing but takes the normal code path", async () => {
      const hasher = create();
      expect(hasher.dummyHash.length).toBeGreaterThanOrEqual(32);
      expect(await hasher.verify(hasher.dummyHash, "any-guess-at-all")).toBe(false);
    });

    it("does not demand a rehash of a hash it just produced", async () => {
      const hasher = create();
      const hash = await hasher.hash("fresh-hash-password");
      expect(hasher.needsRehash(hash)).toBe(false);
    });
  });
}
