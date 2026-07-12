/**
 * Authentication & authorization seams.
 *
 * Vidya #1 shipped these as interfaces with deny-by-default implementations
 * (see deny-all.ts). Vidya #2 adds the role+scope vocabulary and the
 * ScopeChecker seam; the implementations of credential verification,
 * session management and the scope check are HUMAN-OWNED
 * (packages/modules/identity/src/core — see ADR-0012).
 */

// ---------------------------------------------------------------------------
// Roles & org scope (approved model, Vidya #2)
// ---------------------------------------------------------------------------

export const ROLES = ["admin", "principal", "hod", "class_teacher", "teacher", "student", "accountant"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Where a record (or a grant) sits in the org tree that module #3 will own:
 * college → department → class → section. Identifiers are OPAQUE strings
 * (≤64 chars) — the identifier contract with #3; never foreign-keyed here.
 * Hierarchical invariant: section implies class, class implies department.
 */
export interface OrgPath {
  readonly collegeId: string;
  readonly departmentId?: string;
  readonly classId?: string;
  readonly sectionId?: string;
}

/** One unit of authority held by a user (stored in idn_scope_grants). */
export interface ScopeGrant {
  /** The role this authority is exercised under. */
  readonly role: Role;
  /** Most-specific org unit the grant targets. */
  readonly org: OrgPath;
  /** Required iff role === "teacher" (their subject assignment). */
  readonly subjectId?: string;
}

export type AccessAction = "read" | "create" | "update" | "delete" | "approve" | "export";

/** Actions that modify records — the "write" column of the approved matrix. */
export const WRITE_ACTIONS: ReadonlySet<AccessAction> = new Set([
  "create",
  "update",
  "delete",
  "approve",
]);

/**
 * How a calling module describes the record it wants to touch. The caller
 * (which owns the record) supplies the record's org position; the checker
 * never queries another module's tables.
 *
 * Convention (approved model): a record that carries `subjectId` is a
 * "subject record" (e.g. marks); records without it are non-subject records
 * (e.g. attendance, conduct, promotion).
 */
export interface ResourceRef {
  /** Owning module of the record, e.g. "identity", "academics". */
  readonly module: string;
  readonly resourceType: string;
  readonly org: OrgPath;
  readonly subjectId?: string;
  /** Enables the self-access rule (a user reading their own profile). */
  readonly ownerUserId?: string;
}

export interface ScopeDecision {
  readonly granted: boolean;
  /** Machine-readable, safe to log and audit. Never credential material. */
  readonly reason: string;
  /** Which authority satisfied the check, when one did (observability). */
  readonly matchedGrant?: ScopeGrant;
}

/**
 * THE SCOPE-CHECK SEAM — trust center of the platform.
 *
 * HUMAN-AUTHORED implementation (Constitution: Fable designs the interface,
 * writes the conformance suite encoding the approved permission matrix, and
 * never authors the implementation). Required properties:
 *  - pure, synchronous, deterministic, no I/O;
 *  - deny-by-default: no matching authority ⇒ { granted: false, reason };
 *  - org containment computed from OrgPath prefixes alone.
 * The binding permission matrix lives in docs/adr/0010-role-scope-model.md
 * and in packages/modules/identity/src/core/conformance/scope-checker.ts.
 */
export interface ScopeChecker {
  check(caller: Principal, action: AccessAction, resource: ResourceRef): ScopeDecision;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/** The authenticated caller. */
export interface Principal {
  readonly id: string;
  readonly kind: "user" | "service";
  readonly displayName: string | null;
  /** Role memberships, e.g. ["teacher"]. */
  readonly roles: readonly Role[];
  /**
   * Reserved for coarse string permissions; unused by the role+scope model
   * (grants carry the real authority). Kept for forward compatibility.
   */
  readonly scopes: readonly string[];
  /** The caller's scope grants, snapshotted into the session at issue time. */
  readonly grants: readonly ScopeGrant[];
  /** Redis-backed session identifier (null for non-session principals). */
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

// ---------------------------------------------------------------------------
// Route-level authorization (coarse gate; record-level checks use ScopeChecker)
// ---------------------------------------------------------------------------

/**
 * Per-route access requirement, declared statically on each RouteSpec.
 * Empty requirement = any authenticated principal.
 */
export interface AccessRequirement {
  /** Principal must hold at least one of these roles. */
  readonly rolesAnyOf?: readonly Role[];
  /** Principal must hold every one of these coarse scope strings. */
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

/** The route-level policy seam (see role-policy.ts for the #2 implementation). */
export interface AccessPolicy {
  authorize(
    principal: Principal,
    requirement: AccessRequirement,
    context: AuthzContext,
  ): Promise<AuthzDecision>;
}
