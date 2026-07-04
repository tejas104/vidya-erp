/* ===========================================================================
 * HUMAN-OWNED FILE (CODEOWNERS-enforced) — Vidya #2 ownership split.
 *
 * This file must export `createIdentityCore(options): IdentityCore`
 * providing the three security-critical implementations:
 *   1. PasswordHasher      — argon2id hashing + constant-time verification
 *   2. SessionManager      — Redis-backed, signed session tokens
 *   3. ScopeChecker        — the permission matrix of ADR-0010
 *
 * Fable (the AI engineer) authored ONLY this fail-closed gate and may not
 * author the implementations. Your implementation must pass the conformance
 * suites in ./conformance (invoke them from your test files) before #2 can
 * be accepted, and a human reviewer must have read and understood the code.
 *
 * Until the implementations land, every process that composes the identity
 * module refuses to start — deny-by-default at boot, per the approved
 * assignment decision #1.
 * =========================================================================*/

import type { IdentityCore, IdentityCoreOptions } from "./contracts";

export class IdentityCoreNotProvidedError extends Error {
  constructor() {
    super(
      "identity security core not provided: the human-owned implementations " +
        "(PasswordHasher, SessionManager, ScopeChecker) have not been added to " +
        "packages/modules/identity/src/core. The application fails closed until they exist. " +
        "See docs/adr/0012-human-owned-security-core.md.",
    );
    this.name = "IdentityCoreNotProvidedError";
  }
}

export function createIdentityCore(_options: IdentityCoreOptions): IdentityCore {
  throw new IdentityCoreNotProvidedError();
}

export type {
  IdentityCore,
  IdentityCoreOptions,
  IssuedSession,
  PasswordHasher,
  SessionData,
  SessionManager,
  SessionRecord,
} from "./contracts";
