import type {
  AccessPolicy,
  AuthnDecision,
  Authenticator,
  AuthzDecision,
} from "./types";

/**
 * CONTRACT IMPLEMENTATION for the pre-authentication phase (Vidya #1).
 *
 * Real authentication does not exist until Vidya #2, so the gate is a real
 * refusal, not a fake verifier: every request to a non-public route receives
 * 401. This class is replaced (via composition-root wiring, not code edits)
 * by the session authenticator in #2.
 */
export class DenyAllAuthenticator implements Authenticator {
  async authenticate(): Promise<AuthnDecision> {
    return {
      authenticated: false,
      reason: "authentication is not provisioned in this deployment phase (arrives with Vidya #2)",
      challenge: 'Bearer realm="vidya"',
    };
  }
}

/**
 * CONTRACT IMPLEMENTATION for the pre-authorization phase (Vidya #1).
 *
 * Unreachable today (the deny-all authenticator never yields a principal),
 * but wired through the pipeline so #2's role+scope policy slots in without
 * pipeline changes. Denies everything: fail-closed by construction.
 */
export class DenyAllAccessPolicy implements AccessPolicy {
  async authorize(): Promise<AuthzDecision> {
    return {
      granted: false,
      reason: "access policy is not provisioned in this deployment phase (arrives with Vidya #2)",
    };
  }
}
