/**
 * Authentication & authorization seams.
 *
 * Vidya #1 ships these as interfaces with deny-by-default implementations
 * (see deny-all.ts). Vidya #2 replaces the implementations — session-backed
 * authentication (Redis sessions) and a human-authored role+scope access
 * policy — WITHOUT changing these contracts or the defineRoute pipeline.
 */

/** The authenticated caller. Shaped for #2's role+scope model. */
export interface Principal {
  readonly id: string;
  readonly kind: "user" | "service";
  readonly displayName: string | null;
  /** Role names, e.g. "registrar", "faculty". Semantics defined in #2. */
  readonly roles: readonly string[];
  /** Fine-grained scopes, e.g. "attendance:write". Semantics defined in #2. */
  readonly scopes: readonly string[];
  /** Redis-backed session identifier once sessions exist (#2). */
  readonly sessionId: string | null;
}

/** What the pipeline hands the authenticator. Framework-agnostic on purpose. */
export interface AuthnRequest {
  readonly headers: Headers;
  readonly method: string;
  readonly path: string;
  readonly requestId: string;
}

export type AuthnDecision =
  | { readonly authenticated: true; readonly principal: Principal }
  | {
      readonly authenticated: false;
      /** Machine-readable reason, safe to log. Never leaks credential material. */
      readonly reason: string;
      /** Optional WWW-Authenticate challenge returned with the 401. */
      readonly challenge?: string;
    };

export interface Authenticator {
  authenticate(request: AuthnRequest): Promise<AuthnDecision>;
}

/**
 * Per-route access requirement, declared statically on each RouteSpec.
 * Empty requirement = any authenticated principal.
 */
export interface AccessRequirement {
  /** Principal must hold at least one of these roles. */
  readonly rolesAnyOf?: readonly string[];
  /** Principal must hold every one of these scopes. */
  readonly scopesAllOf?: readonly string[];
}

export type AuthzDecision =
  | { readonly granted: true }
  | { readonly granted: false; readonly reason: string };

export interface AuthzContext {
  readonly module: string;
  readonly routeId: string;
  readonly requestId: string;
}

/**
 * The scope-check seam. The #2 implementation of this interface is a
 * human-authored, security-critical component with a near-exhaustive
 * branch-coverage requirement (see docs/security-review.md#coverage-policy).
 */
export interface AccessPolicy {
  authorize(
    principal: Principal,
    requirement: AccessRequirement,
    context: AuthzContext,
  ): Promise<AuthzDecision>;
}
