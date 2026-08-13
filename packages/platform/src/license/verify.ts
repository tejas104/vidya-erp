import { verify as cryptoVerify, type KeyObject } from "node:crypto";

/**
 * Offline license verification (#12 step 4 dependency).
 *
 * See docs/superpowers/specs/2026-08-13-license-verification-design.md for
 * the full design and the three owner-ruled decisions. The one that matters
 * most here: THIS MODULE NEVER GATES ANYTHING. `LicenseStatus` drives
 * presentation and a single boot audit event — nothing else reads it to
 * decide whether a request is allowed. There is no enforcement code in this
 * file, and there should never be.
 *
 * Pure and deterministic: no I/O, no logging, no ambient clock (`now` is
 * injected). Never throws — any malformed input resolves to `invalid`,
 * because a bad license file must never crash the boot path.
 */

export type LicenseEdition = "college" | "school";

export interface LicenseClaims {
  readonly v: 1;
  readonly id: string;
  readonly customer: string;
  readonly edition: LicenseEdition;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly seats: number;
  readonly notBefore?: string;
}

export type LicenseInvalidReason =
  | "malformed"
  | "bad-signature"
  | "unsupported-version"
  | "not-yet-valid"
  | "edition-mismatch";

export type LicenseStatus =
  | { kind: "valid"; claims: LicenseClaims; daysRemaining: number }
  | { kind: "grace"; claims: LicenseClaims; daysOverdue: number }
  | { kind: "expired"; claims: LicenseClaims; daysOverdue: number }
  | { kind: "invalid"; reason: LicenseInvalidReason }
  | { kind: "absent" };

const MS_PER_DAY = 86_400_000;
const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Days past `expiresAt` during which the status is `grace` rather than
 * `expired`. Presentation-only bucketing (a softer banner wording), NOT an
 * enforcement window — nothing in this codebase branches on grace vs.
 * expired to allow or deny anything; both keep every feature working
 * (DECISION 1). 30 is the only number the spec ever attaches to "grace"
 * (it was the write-blocking cliff in the rejected proposal); reused here
 * as a status boundary now that no enforcement rides on it.
 */
const GRACE_WINDOW_DAYS = 30;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict base64url decode: rejects anything containing characters outside the base64url alphabet, rather than silently dropping them the way Buffer.from does. */
function decodeBase64Url(segment: string): Buffer | null {
  if (segment.length === 0 || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    return null;
  }
  return Buffer.from(segment, "base64url");
}

/** Claims carry date-only strings (`YYYY-MM-DD`); parsed as UTC midnight so verification never depends on the host's local timezone. */
function parseDateOnlyUtc(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

function invalid(reason: LicenseInvalidReason): LicenseStatus {
  return { kind: "invalid", reason };
}

/**
 * Verifies a `base64url(payload).base64url(signature)` license token.
 *
 * Verification order is the load-bearing part of this function:
 *   1. Split the token into its two segments and base64url-decode each.
 *   2. Verify the Ed25519 signature over the RAW PAYLOAD BYTES.
 *   3. Only once the signature checks out: parse those bytes as JSON and
 *      validate claims.
 *
 * Signature-before-parse is deliberate and non-negotiable (spec, "The
 * mechanism"): parsing untrusted JSON first and checking the signature
 * after would mean a tampered payload could reach a JSON parser — and if
 * any later bug forgot the signature check, or `parse` had a side effect,
 * that ordering is where it bites. Verifying raw bytes first means nothing
 * downstream ever sees a claim that didn't come from the holder of the
 * private key.
 */
export function verifyLicense(
  token: string,
  publicKey: KeyObject,
  now: Date,
  edition: LicenseEdition,
): LicenseStatus {
  try {
    if (token === "") {
      // No license configured is not the same failure as a tampered one —
      // a fresh install and a corrupted install deserve different messages.
      return { kind: "absent" };
    }

    const dotIndex = token.indexOf(".");
    if (dotIndex === -1 || token.indexOf(".", dotIndex + 1) !== -1) {
      return invalid("malformed"); // not exactly two segments
    }

    const payloadBytes = decodeBase64Url(token.slice(0, dotIndex));
    const signatureBytes = decodeBase64Url(token.slice(dotIndex + 1));
    if (payloadBytes === null || signatureBytes === null) {
      return invalid("malformed");
    }

    // --- signature first, over the raw bytes, before any JSON.parse ---
    let signatureValid: boolean;
    try {
      signatureValid = cryptoVerify(null, payloadBytes, publicKey, signatureBytes);
    } catch {
      signatureValid = false; // e.g. wrong-length signature — never throw
    }
    if (!signatureValid) {
      return invalid("bad-signature");
    }

    // --- parse only after the bytes are proven to come from the key holder ---
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadBytes.toString("utf8"));
    } catch {
      return invalid("malformed");
    }
    if (!isPlainObject(parsed)) {
      return invalid("malformed");
    }

    if (parsed.v !== SUPPORTED_SCHEMA_VERSION) {
      return invalid("unsupported-version");
    }

    const { id, customer, edition: claimedEdition, issuedAt, expiresAt, seats, notBefore } = parsed;

    // customer and edition are required (owner-ruled): missing either must
    // never default, fall back, or be treated as a wildcard.
    if (typeof customer !== "string" || customer.length === 0) {
      return invalid("malformed");
    }
    if (claimedEdition !== "college" && claimedEdition !== "school") {
      return invalid("malformed");
    }
    if (typeof id !== "string" || id.length === 0) {
      return invalid("malformed");
    }
    if (typeof issuedAt !== "string" || typeof expiresAt !== "string") {
      return invalid("malformed");
    }
    if (typeof seats !== "number" || !Number.isFinite(seats) || seats < 0) {
      return invalid("malformed");
    }
    if (notBefore !== undefined && typeof notBefore !== "string") {
      return invalid("malformed");
    }

    const expiresAtMs = parseDateOnlyUtc(expiresAt);
    if (expiresAtMs === null) {
      return invalid("malformed");
    }

    const nowMs = now.getTime();

    if (notBefore !== undefined) {
      const notBeforeMs = parseDateOnlyUtc(notBefore);
      if (notBeforeMs === null) {
        return invalid("malformed");
      }
      if (nowMs < notBeforeMs) {
        return invalid("not-yet-valid");
      }
    }

    // The license is cryptographically valid at this point — an edition
    // mismatch is a claims problem, not a signature problem, and must be
    // reported as such (distinct from bad-signature) for support diagnosis.
    if (claimedEdition !== edition) {
      return invalid("edition-mismatch");
    }

    const claims: LicenseClaims = {
      v: 1,
      id,
      customer,
      edition: claimedEdition,
      issuedAt,
      expiresAt,
      seats,
      ...(notBefore !== undefined ? { notBefore } : {}),
    };

    // expiresAt is a date, not an instant: the license is good through the
    // entire expiresAt day (UTC), so the boundary is midnight the day after.
    const expiryBoundaryMs = expiresAtMs + MS_PER_DAY;

    if (nowMs < expiryBoundaryMs) {
      const daysRemaining = Math.ceil((expiryBoundaryMs - nowMs) / MS_PER_DAY);
      return { kind: "valid", claims, daysRemaining };
    }

    const daysOverdue = Math.floor((nowMs - expiryBoundaryMs) / MS_PER_DAY);
    if (daysOverdue <= GRACE_WINDOW_DAYS) {
      return { kind: "grace", claims, daysOverdue };
    }
    return { kind: "expired", claims, daysOverdue };
  } catch {
    // Belt and braces: verifyLicense must never throw, no matter what
    // shape of garbage a corrupted license file hands it.
    return invalid("malformed");
  }
}
