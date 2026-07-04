/* ===========================================================================
 * HUMAN-OWNED FILE (CODEOWNERS-enforced) — Vidya #2 ownership split.
 *
 * Exports `createIdentityCore(options): IdentityCore`, assembling the three
 * security-critical implementations:
 *   1. PasswordHasher  — argon2id (password-hasher.ts)
 *   2. SessionManager  — split-token, Redis-backed (session-manager.ts)
 *   3. ScopeChecker    — the ADR-0010 permission matrix (scope-checker.ts)
 *
 * The implementations were authored by the security team. This wiring (and
 * the ADR-0013 matrix extension for people-module administration) was
 * applied by Fable under the owner's explicit #3 authorization to proceed
 * without a human handoff — flagged in docs/review-gate-3.md for security-
 * team ratification. Acceptance still requires the conformance suites
 * (./conformance) to pass and a human to have read and understood the
 * implementation files.
 * =========================================================================*/

import type { IdentityCore, IdentityCoreOptions } from "./contracts";
import { Argon2PasswordHasher } from "./password-hasher";
import { createSessionManager } from "./session-manager";
import { createScopeChecker } from "./scope-checker";

export function createIdentityCore(options: IdentityCoreOptions): IdentityCore {
  return {
    passwordHasher: new Argon2PasswordHasher(),
    sessionManager: createSessionManager({
      redis: options.redis,
      session: {
        ttlSeconds: options.session.ttlHours * 3600,
        idleSeconds: options.session.idleMinutes * 60,
      },
    }),
    scopeChecker: createScopeChecker(),
  };
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
