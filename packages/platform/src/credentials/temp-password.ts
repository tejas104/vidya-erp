import { randomInt } from "node:crypto";

/**
 * Temporary-password generation (#11 D1, owner-ratified).
 *
 * This deliberately sits OUTSIDE packages/modules/identity/src/core/: that
 * boundary exists for primitives whose parameter quality cannot be proven by
 * tests (argon2 cost, session signing). Drawing uniformly from a fixed
 * alphabet has no such tunable — it is auditable in full, right here.
 *
 * randomInt is the CSPRNG with rejection sampling built in, so the draw is
 * uniform; a naive randomBytes % alphabet.length would bias toward the first
 * characters. The alphabet omits 0/O/1/l/I because these passwords get
 * PRINTED on a sheet and typed by a student from paper.
 */
export const TEMP_PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTemporaryPassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}
