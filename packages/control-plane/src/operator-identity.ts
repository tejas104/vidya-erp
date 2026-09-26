import { z } from "zod";

const assuredClaimsSchema = z.object({
  iss: z.string().url().max(255),
  sub: z.string().min(3).max(255),
  acr: z.string().min(1).max(255),
  auth_time: z.number().int().nonnegative(),
}).passthrough();

declare const assuredIdentityBrand: unique symbol;
export type AssuredOperatorIdentity = Readonly<{
  issuer: string; subject: string; [assuredIdentityBrand]: true;
}>;
const assuredIdentities = new WeakSet<object>();

export function isAssuredOperatorIdentity(value: unknown): value is AssuredOperatorIdentity {
  return typeof value === "object" && value !== null && assuredIdentities.has(value);
}

/**
 * Check assurance claims from an ID token AFTER an OIDC adapter has verified
 * its signature, issuer, audience, nonce, expiry and login transaction.
 * This function does not validate a token and must never receive browser JSON.
 */
export function assuredOperatorIdentity(
  verifiedClaims: unknown,
  policy: { issuer: string; requiredAcr: string; maxAuthAgeSeconds: number },
  now: Date,
): AssuredOperatorIdentity {
  const claims = assuredClaimsSchema.safeParse(verifiedClaims);
  if (!claims.success || !Number.isFinite(now.getTime()) ||
      !policy.issuer.startsWith("https://") || !policy.requiredAcr ||
      !Number.isInteger(policy.maxAuthAgeSeconds) || policy.maxAuthAgeSeconds < 1 ||
      policy.maxAuthAgeSeconds > 43_200) {
    throw new Error("operator identity assurance failed");
  }
  const { iss, sub, acr, auth_time: authTime } = claims.data;
  const ageSeconds = Math.floor(now.getTime() / 1000) - authTime;
  if (iss !== policy.issuer || acr !== policy.requiredAcr ||
      sub.trim() !== sub || ageSeconds < -60 || ageSeconds > policy.maxAuthAgeSeconds) {
    throw new Error("operator identity assurance failed");
  }
  const identity = Object.freeze({ issuer: iss, subject: sub }) as AssuredOperatorIdentity;
  assuredIdentities.add(identity);
  return identity;
}
