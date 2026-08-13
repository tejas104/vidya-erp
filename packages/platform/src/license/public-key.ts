import { createPublicKey, type KeyObject } from "node:crypto";

/**
 * Build-time public key for verifying signed license files (Ed25519,
 * ADR-0009 — no new dependency, node:crypto only).
 *
 * This is PUBLIC data — safe to commit, unlike its private counterpart
 * (never in this repo, never in a container image, never in CI). Not
 * env-configurable on purpose: an env-supplied public key would let anyone
 * self-sign a license, which defeats the point.
 *
 * PLACEHOLDER: this is a freshly generated throwaway key. No license has
 * ever been issued against it, and its private half was never written to
 * disk. Before cutting the first real release, run
 * `npx tsx scripts/license-keygen.ts --out <secure path>` and paste the
 * printed constant here — that is the entire key-rotation procedure.
 */
export const LICENSE_PUBLIC_KEY_DER_BASE64 =
  "MCowBQYDK2VwAyEAdxqYSPYwCyd/yxd9a7rPbCYYDIRo5aOtTDFf+f0/ONg=";

export const LICENSE_PUBLIC_KEY: KeyObject = createPublicKey({
  key: Buffer.from(LICENSE_PUBLIC_KEY_DER_BASE64, "base64"),
  format: "der",
  type: "spki",
});
