import type { AccessAction, OrgPath, Principal, RouteContext, RouteHandler, RouteResult, ScopeChecker } from "@vidya/platform";
import { UsernameTakenError } from "@vidya/module-identity";
import type { RelationshipType } from "../guardian-contract/types";
import { PupilHasLeftError, type InvitationRow, type RelationshipRow } from "./repo";
import { InvitationRefusedError, type GuardianService, type StudentBrief } from "./service";

export interface GuardianHandlerDeps {
  readonly guardians: GuardianService;
  readonly scopeChecker: ScopeChecker;
  readonly student: (studentId: string) => Promise<StudentBrief | null>;
  /** The pupil's org position (enrollment-derived) for staff scope checks. */
  readonly studentPosition: (studentId: string) => Promise<OrgPath | null>;
}

const notFound: RouteResult = { status: 404, body: { message: "not found" } };
const deniedResult: RouteResult = { status: 403, body: { message: "access denied" } };
// One refusal for every reason a code cannot be used, so the endpoint is not
// an oracle for which codes exist, were spent, or lapsed.
const unusableCode: RouteResult = { status: 400, body: { message: "This invitation code cannot be used. Ask the school for a new one." } };

function relationshipView(row: RelationshipRow & { guardianName?: string }) {
  return {
    id: row.id,
    guardianName: row.guardianName ?? "",
    relationshipType: row.relationshipType,
    isPrimaryContact: row.isPrimaryContact,
    verificationState: row.verificationState,
    status: row.status,
    categories: [...row.grantedCategories].sort(),
    statusReason: row.statusReason,
    since: row.validFrom.toISOString(),
  };
}

function invitationView(row: InvitationRow) {
  return {
    id: row.id,
    guardianName: row.guardianName,
    relationshipType: row.relationshipType,
    contactMethod: row.contactMethod,
    contactValue: row.contactValue,
    staffVerified: row.staffVerified,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export function createGuardianHandlers(deps: GuardianHandlerDeps): Record<string, RouteHandler> {
  /** Staff may act on a pupil's guardians only where they may act on the pupil. */
  async function staffScope(
    ctx: RouteContext,
    studentId: string,
    action: AccessAction,
  ): Promise<{ ok: true; student: StudentBrief; org: OrgPath } | { ok: false; result: RouteResult }> {
    const student = await deps.student(studentId);
    if (student === null) return { ok: false, result: notFound };
    const org = (await deps.studentPosition(studentId)) ?? { collegeId: student.collegeId };
    const decision = deps.scopeChecker.check(ctx.principal as Principal, action, { module: "people", resourceType: "student", org });
    if (!decision.granted) {
      ctx.logger.warn({ reason: decision.reason }, "scope check denied");
      return { ok: false, result: deniedResult };
    }
    return { ok: true, student, org };
  }

  const studentGuardians: RouteHandler = async (ctx) => {
    const { studentId } = ctx.request.params as { studentId: string };
    const scope = await staffScope(ctx, studentId, "read");
    if (!scope.ok) return scope.result;
    const { relationships, invitations } = await deps.guardians.forStudent(studentId);
    return {
      status: 200,
      body: { relationships: relationships.map(relationshipView), invitations: invitations.map(invitationView) },
      headers: { "cache-control": "no-store" },
    };
  };

  const invitationIssue: RouteHandler = async (ctx) => {
    const { studentId } = ctx.request.params as { studentId: string };
    const body = ctx.request.body as {
      guardianName: string;
      relationshipType: RelationshipType;
      contactMethod: "sms" | "email";
      contactValue: string;
      staffVerified: boolean;
    };
    const scope = await staffScope(ctx, studentId, "update");
    if (!scope.ok) return scope.result;
    let issued;
    try {
      issued = await deps.guardians.issueInvitation({ ...body, student: scope.student, issuedBy: (ctx.principal as Principal).id });
    } catch (error) {
      if (error instanceof PupilHasLeftError) return { status: 409, body: { message: error.message } };
      throw error;
    }
    return {
      status: 201,
      body: { invitation: invitationView(issued.invitation), code: issued.code },
      headers: { "cache-control": "no-store" },
      // The code is deliberately absent: the audit log must never hold a
      // usable credential.
      audit: {
        org: scope.org,
        resourceId: studentId,
        details: {
          invitationId: issued.invitation.id,
          relationshipType: body.relationshipType,
          contactMethod: body.contactMethod,
          staffVerified: body.staffVerified,
          revokedPrior: issued.revokedPrior,
        },
      },
    };
  };

  async function changeRelationship(ctx: RouteContext, change: (row: RelationshipRow, actorId: string) => Promise<RelationshipRow | null>, details: Record<string, unknown>, refuseRevoked = false) {
    const { relationshipId } = ctx.request.params as { relationshipId: string };
    const row = await deps.guardians.getRelationship(relationshipId);
    if (row === null) return notFound;
    const scope = await staffScope(ctx, row.studentId, "update");
    if (!scope.ok) return scope.result;
    if (refuseRevoked && row.status === "revoked") {
      return { status: 409, body: { message: "a revoked relationship is re-established by a new invitation, not by verification" } };
    }
    const updated = await change(row, (ctx.principal as Principal).id);
    if (updated === null) return { status: 409, body: { message: "relationship changed; reload and try again" } };
    return {
      status: 200,
      body: { relationship: relationshipView(updated) },
      audit: {
        org: scope.org,
        resourceId: relationshipId,
        details: { studentId: row.studentId, before: row.status, after: updated.status, ...details },
      },
    };
  }

  const relationshipVerify: RouteHandler = async (ctx) => {
    return changeRelationship(ctx, (r, actor) => deps.guardians.verify(r, actor), {}, true);
  };

  const relationshipRevoke: RouteHandler = async (ctx) => {
    const { reason } = ctx.request.body as { reason: string };
    return changeRelationship(ctx, (row, actor) => deps.guardians.revoke(row, reason, actor), { reason });
  };

  const activate: RouteHandler = async (ctx) => {
    const body = ctx.request.body as { code: string; fullName: string; username: string; password: string };
    try {
      const activated = await deps.guardians.activate(body);
      return {
        status: 201,
        body: { username: activated.username, child: { fullName: activated.student.fullName }, status: activated.relationship.status },
        audit: {
          actor: { type: "guardian", id: activated.userId },
          org: { collegeId: activated.student.collegeId },
          resourceId: activated.relationship.id,
          details: { studentId: activated.student.studentId, guardianId: activated.guardianId, status: activated.relationship.status },
        },
      };
    } catch (error) {
      if (error instanceof InvitationRefusedError) {
        ctx.logger.warn({ reason: error.reason }, "guardian invitation refused");
        return unusableCode;
      }
      if (error instanceof UsernameTakenError) {
        return { status: 409, body: { message: "That username is taken. Choose another." } };
      }
      throw error;
    }
  };

  const redeem: RouteHandler = async (ctx) => {
    const { code } = ctx.request.body as { code: string };
    try {
      const redeemed = await deps.guardians.redeem({ code, identityUserId: (ctx.principal as Principal).id });
      return {
        status: 201,
        body: { child: { fullName: redeemed.student.fullName }, status: redeemed.relationship.status },
        audit: {
          org: { collegeId: redeemed.student.collegeId },
          resourceId: redeemed.relationship.id,
          details: { studentId: redeemed.student.studentId, guardianId: redeemed.guardianId, status: redeemed.relationship.status },
        },
      };
    } catch (error) {
      if (error instanceof InvitationRefusedError) {
        ctx.logger.warn({ reason: error.reason }, "guardian invitation refused");
        return unusableCode;
      }
      throw error;
    }
  };

  const children: RouteHandler = async (ctx) => ({
    status: 200,
    body: { children: await deps.guardians.children((ctx.principal as Principal).id) },
    headers: { "cache-control": "no-store" },
  });

  return {
    "people.student-guardians": studentGuardians,
    "people.guardian-invitation-issue": invitationIssue,
    "people.guardian-relationship-verify": relationshipVerify,
    "people.guardian-relationship-revoke": relationshipRevoke,
    "people.guardian-activate": activate,
    "people.guardian-redeem": redeem,
    "people.guardian-children": children,
  };
}
