import type {
  AccessAction,
  OrgPath,
  Principal,
  ResourceRef,
  ScopeChecker,
  ScopeDecision,
  ScopeGrant,
} from "@vidya/platform";

/**
 * The ADR-0010 permission matrix as a pure function. Authority comes only
 * from grants (role membership alone conveys nothing); the one exception
 * is self-access: anyone may READ a record whose ownerUserId is their own
 * id. Everything else is deny-by-default.
 *
 * Org containment is computed from OrgPath prefixes alone: a grant covers
 * a resource when every level the grant specifies matches the resource
 * exactly. A grant that is MORE specific than the resource (e.g. a
 * section-scoped grant against a class-wide record) does not cover it —
 * authority never widens upward.
 */

function covers(grantOrg: OrgPath, resourceOrg: OrgPath): boolean {
  return (
    grantOrg.collegeId === resourceOrg.collegeId &&
    (grantOrg.departmentId === undefined || grantOrg.departmentId === resourceOrg.departmentId) &&
    (grantOrg.classId === undefined || grantOrg.classId === resourceOrg.classId) &&
    (grantOrg.sectionId === undefined || grantOrg.sectionId === resourceOrg.sectionId)
  );
}

/**
 * Convention (ADR-0010): a record carrying subjectId is a "subject record"
 * (marks); records without it are non-subject records (attendance,
 * conduct, promotion).
 */
function grantAllows(grant: ScopeGrant, action: AccessAction, resource: ResourceRef): boolean {
  if (!covers(grant.org, resource.org)) {
    return false;
  }
  switch (grant.role) {
    case "teacher":
      // Teachers may:
      // - read non-subject records (attendance, conduct, promotion, ...)
      // - read subject records only for their own subject — other
      //   subjects' marks stay private to their teachers
      // - write only their own subject records
      switch (action) {
        case "read":
          return (
            resource.subjectId === undefined ||
            resource.subjectId === grant.subjectId
          );
        case "create":
        case "update":
        case "delete":
          return (
            resource.subjectId !== undefined &&
            resource.subjectId === grant.subjectId
          );
        default:
          return false;
      }
    case "class_teacher":
      // Reads their class, all sections/subjects; writes only the class's
      // non-subject records — never subject marks.
      switch (action) {
        case "read":
          return true;
        case "create":
        case "update":
        case "delete":
          return resource.subjectId === undefined;
        default:
          return false;
      }
    case "hod":
      // Reads the whole department; "approve" is their only write verb.
      // Export follows read scope (bulk-exfiltration control: hod,
      // principal and admin only).
      return action === "read" || action === "approve" || action === "export";
    case "principal":
      // Pure viewer, college-wide.
      return action === "read" || action === "export";
    case "admin":
      // Reads college-wide for support; writes ADMINISTRATIVE records only:
      // identity (users/roles/grants, ADR-0010) and people (org structure,
      // student/teacher records, enrollment — ADR-0013, owner-authorized
      // matrix extension for Vidya #3). Never academic records
      // (marks/attendance etc. live in the academics module), and approve
      // stays hod-only.
      switch (action) {
        case "read":
        case "export":
          return true;
        case "create":
        case "update":
        case "delete":
          return resource.module === "identity" || resource.module === "people";
        default:
          return false;
      }
  }
}

class GrantMatrixScopeChecker implements ScopeChecker {
  check(caller: Principal, action: AccessAction, resource: ResourceRef): ScopeDecision {
    if (action === "read" && resource.ownerUserId !== undefined && resource.ownerUserId === caller.id) {
      return { granted: true, reason: "self-access: caller owns the record" };
    }
    for (const grant of caller.grants) {
      // Grants are FK-bound to held roles in idn_scope_grants; re-checking
      // here keeps the function safe on any Principal it is handed.
      if (!caller.roles.includes(grant.role)) {
        continue;
      }
      if (grantAllows(grant, action, resource)) {
        return {
          granted: true,
          reason: `${grant.role} grant permits ${action}`,
          matchedGrant: grant,
        };
      }
    }
    return {
      granted: false,
      reason: `deny-by-default: no grant permits ${action} on ${resource.module}/${resource.resourceType}`,
    };
  }
}

export function createScopeChecker(): ScopeChecker {
  return new GrantMatrixScopeChecker();
}
