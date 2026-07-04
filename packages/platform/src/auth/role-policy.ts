import type {
  AccessPolicy,
  AccessRequirement,
  AuthzDecision,
  Principal,
} from "./types";

/**
 * Route-level authorization for the role+scope model (Vidya #2):
 * evaluates a RouteSpec's static AccessRequirement against the principal.
 *
 * This is the COARSE gate (may this kind of user call this route at all?).
 * Record-level decisions are the ScopeChecker's job and happen in handlers.
 * No role hierarchy exists — approved model: every permission is explicit.
 */
export class RoleRequirementPolicy implements AccessPolicy {
  async authorize(
    principal: Principal,
    requirement: AccessRequirement,
  ): Promise<AuthzDecision> {
    if (requirement.rolesAnyOf !== undefined && requirement.rolesAnyOf.length > 0) {
      const held = requirement.rolesAnyOf.some((role) => principal.roles.includes(role));
      if (!held) {
        return {
          granted: false,
          reason: `requires one of roles [${requirement.rolesAnyOf.join(", ")}]`,
        };
      }
    }
    if (requirement.scopesAllOf !== undefined && requirement.scopesAllOf.length > 0) {
      const missing = requirement.scopesAllOf.filter(
        (scope) => !principal.scopes.includes(scope),
      );
      if (missing.length > 0) {
        return { granted: false, reason: `missing scopes [${missing.join(", ")}]` };
      }
    }
    return { granted: true };
  }
}
