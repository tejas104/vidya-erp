import { createPublicKey, type KeyObject } from "node:crypto";

/**
 * Build-time public key for verifying signed license files (Ed25519,
 * ADR-0009 — no new dependency, node:crypto only).
 *
 * This is PUBLIC data — safe to commit, unlike its private counterpart
 * (never in this repo, never in a container image, never in CI). Not
 * env-configurable on purpose: an env-supplied public key would let anyone
 * self-sign a license, which defeats the point.
 */
export const LICENSE_PUBLIC_KEY_DER_BASE64 =
  "MCowBQYDK2VwAyEAXWXj79+KarShSxMfMY5yqhtm3u9C1vHs/8I6O3oBd8I=";

export const LICENSE_PUBLIC_KEY: KeyObject = createPublicKey({
  key: Buffer.from(LICENSE_PUBLIC_KEY_DER_BASE64, "base64"),
  format: "der",
  type: "spki",
});
