import type { Counter } from "prom-client";
import type {
  Principal,
  ResourceRef,
  Role,
  RouteContext,
  RouteHandler,
  RouteResult,
  ScopeChecker,
} from "@vidya/platform";
import type { AuthService } from "../service/auth-service";
import {
  DerivedGrantImmutableError,
  InvalidOrgPathError,
  UsersService,
} from "../service/users-service";
import type { GrantVerificationService } from "../service/grant-verification";
import { RoleNotHeldError, UsernameTakenError } from "../repo/users-repo";
import { buildSessionCookie, clearSessionCookie, type CookiePolicy } from "../service/cookies";

export interface IdentityHandlerDeps {
  readonly users: UsersService;
  readonly auth: AuthService;
  readonly grantVerification: GrantVerificationService;
  readonly scopeChecker: ScopeChecker;
  readonly cookiePolicy: CookiePolicy;
  readonly loginsTotal: Counter<"outcome">;
  readonly throttleWindowMinutes: number;
}

/**
 * Best-effort client address for throttling keys. Behind the on-prem
 * reverse proxy the first x-forwarded-for hop is proxy-controlled and
 * trustworthy; direct connections fall back to a shared bucket
 * (docs/threat-model-identity.md#throttle-keying).
 */
function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") {
      return first;
    }
  }
  return "direct";
}

function denied(ctx: RouteContext, reason: string): RouteResult {
  ctx.logger.warn({ reason }, "scope check denied");
  return { status: 403, body: { message: "access denied" } };
}

function notFound(): RouteResult {
  return { status: 404, body: { message: "not found" } };
}

/** Every record-level decision in this module flows through this helper. */
function checkScope(
  scopeChecker: ScopeChecker,
  ctx: RouteContext,
  principal: Principal,
  action: Parameters<ScopeChecker["check"]>[1],
  resource: ResourceRef,
): { ok: true } | { ok: false; result: RouteResult } {
  const decision = scopeChecker.check(principal, action, resource);
  if (!decision.granted) {
    return { ok: false, result: denied(ctx, decision.reason) };
  }
  return { ok: true };
}

export function createIdentityHandlers(deps: IdentityHandlerDeps): Record<string, RouteHandler> {
  const login: RouteHandler = async (ctx): Promise<RouteResult> => {
    const body = ctx.request.body as { username: string; password: string };
    const result = await deps.auth.login(body.username, body.password, clientIp(ctx.request.headers));
    deps.loginsTotal.inc({ outcome: result.outcome });
    switch (result.outcome) {
      case "locked":
        return {
          status: 429,
          body: { message: "too many failed attempts; try again later" },
          headers: { "retry-after": String(deps.throttleWindowMinutes * 60) },
        };
      case "invalid-credentials":
        return { status: 401, body: { message: "invalid credentials" } };
      case "reset-required":
        return { status: 403, body: { message: "password reset required before login" } };
      case "success": {
        const maxAgeSeconds = Math.floor((result.expiresAt.getTime() - Date.now()) / 1000);
        return {
          status: 200,
          body: { user: result.user, expiresAt: result.expiresAt.toISOString() },
          headers: {
            "set-cookie": buildSessionCookie(deps.cookiePolicy, result.token, maxAgeSeconds),
            "cache-control": "no-store",
          },
          audit: {
            actor: { type: "user", id: result.user.id },
            resourceId: result.sessionId,
          },
        };
      }
    }
  };

  const logout: RouteHandler = async (ctx) => {
    const principal = ctx.principal;
    if (principal?.sessionId != null) {
      await deps.auth.logout(principal.sessionId);
    }
    return {
      status: 200,
      body: { ok: true as const },
      headers: { "set-cookie": clearSessionCookie(deps.cookiePolicy) },
      audit: { resourceId: principal?.sessionId ?? undefined },
    };
  };

  const session: RouteHandler = async (ctx) => {
    const principal = ctx.principal;
    if (principal === null) {
      return { status: 401, body: { message: "unauthenticated" } };
    }
    return {
      status: 200,
      body: {
        userId: principal.id,
        displayName: principal.displayName ?? "",
        roles: principal.roles,
        grants: principal.grants,
      },
      headers: { "cache-control": "no-store" },
    };
  };

  const passwordChange: RouteHandler = async (ctx) => {
    const principal = ctx.principal;
    if (principal === null) {
      return { status: 401, body: { message: "unauthenticated" } };
    }
    const body = ctx.request.body as { currentPassword: string; newPassword: string };
    const changed = await deps.auth.changePassword(
      principal.id,
      body.currentPassword,
      body.newPassword,
    );
    if (!changed) {
      return { status: 401, body: { message: "current password incorrect" } };
    }
    return {
      status: 200,
      body: { ok: true as const },
      headers: { "set-cookie": clearSessionCookie(deps.cookiePolicy) },
      audit: { resourceId: principal.id },
    };
  };

  const passwordResetConfirm: RouteHandler = async (ctx): Promise<RouteResult> => {
    const body = ctx.request.body as { token: string; newPassword: string };
    const result = await deps.auth.confirmReset(
      body.token,
      body.newPassword,
      clientIp(ctx.request.headers),
    );
    switch (result.outcome) {
      case "locked":
        return {
          status: 429,
          body: { message: "too many attempts; try again later" },
          headers: { "retry-after": String(deps.throttleWindowMinutes * 60) },
        };
      case "invalid-token":
        return { status: 401, body: { message: "token invalid, expired or already used" } };
      case "success":
        return {
          status: 200,
          body: { ok: true as const },
          audit: {
            actor: { type: "user", id: result.userId },
            resourceId: result.userId,
          },
        };
    }
  };

  const userCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      username: string;
      displayName: string;
      collegeId: string;
      temporaryPassword: string;
      roles: Role[];
    };
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "identity",
      resourceType: "user",
      org: { collegeId: body.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const created = await deps.users.createUser({
        username: body.username,
        displayName: body.displayName,
        collegeId: body.collegeId,
        temporaryPassword: body.temporaryPassword,
        roles: body.roles,
        createdBy: principal.id,
      });
      return {
        status: 201,
        body: created,
        audit: {
          resourceId: created.id,
          details: { username: created.username, roles: created.roles, collegeId: created.collegeId },
        },
      };
    } catch (error) {
      if (error instanceof UsernameTakenError) {
        return { status: 409, body: { message: "username already taken" } };
      }
      throw error;
    }
  };

  const userList: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { collegeId: string; limit: number; offset: number };
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", {
      module: "identity",
      resourceType: "user-directory",
      org: { collegeId: query.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    const users = await deps.users.listUsers(query.collegeId, query.limit, query.offset);
    return { status: 200, body: { users } };
  };

  const userGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { userId: string };
    const user = await deps.users.getUser(params.userId);
    if (user === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", {
      module: "identity",
      resourceType: "user-profile",
      org: { collegeId: user.collegeId },
      ownerUserId: user.id,
    });
    if (!scope.ok) {
      return scope.result;
    }
    return { status: 200, body: user };
  };

  const userUpdate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { userId: string };
    const body = ctx.request.body as { displayName?: string; status?: "active" | "disabled" };
    const existing = await deps.users.getUserRecord(params.userId);
    if (existing === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "identity",
      resourceType: "user",
      org: { collegeId: existing.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    const updated = await deps.users.updateUser(params.userId, body);
    if (updated === null) {
      return notFound();
    }
    return {
      status: 200,
      body: updated,
      audit: {
        resourceId: updated.id,
        details: {
          before: { displayName: existing.displayName, status: existing.status },
          after: { displayName: updated.displayName, status: updated.status },
        },
      },
    };
  };

  const rolesSet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { userId: string };
    const body = ctx.request.body as { roles: Role[] };
    const existing = await deps.users.getUserRecord(params.userId);
    if (existing === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "identity",
      resourceType: "user-roles",
      org: { collegeId: existing.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    const change = await deps.users.setRoles(params.userId, body.roles, principal.id);
    if (change === null) {
      return notFound();
    }
    return {
      status: 200,
      body: { roles: change.after },
      audit: { resourceId: params.userId, details: { before: change.before, after: change.after } },
    };
  };

  const grantAdd: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { userId: string };
    const body = ctx.request.body as {
      role: Role;
      collegeId: string;
      departmentId?: string;
      classId?: string;
      sectionId?: string;
      subjectId?: string;
    };
    const existing = await deps.users.getUserRecord(params.userId);
    if (existing === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "identity",
      resourceType: "scope-grant",
      org: { collegeId: body.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const stored = await deps.users.addGrant(params.userId, {
        role: body.role,
        org: {
          collegeId: body.collegeId,
          ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
          ...(body.classId !== undefined ? { classId: body.classId } : {}),
          ...(body.sectionId !== undefined ? { sectionId: body.sectionId } : {}),
        },
        ...(body.subjectId !== undefined ? { subjectId: body.subjectId } : {}),
        grantedBy: principal.id,
      });
      if (stored === null) {
        return notFound();
      }
      return {
        status: 201,
        body: UsersService.grantView(stored),
        audit: {
          resourceId: stored.id,
          details: { userId: params.userId, grant: UsersService.grantView(stored) },
        },
      };
    } catch (error) {
      if (error instanceof RoleNotHeldError) {
        return { status: 409, body: { message: error.message } };
      }
      if (error instanceof InvalidOrgPathError) {
        return { status: 422, body: { message: error.message } };
      }
      throw error;
    }
  };

  const grantRemove: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { userId: string; grantId: string };
    const existing = await deps.users.getUserRecord(params.userId);
    if (existing === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "delete", {
      module: "identity",
      resourceType: "scope-grant",
      org: { collegeId: existing.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    let removed: boolean | null;
    try {
      removed = await deps.users.removeGrant(params.userId, params.grantId);
    } catch (error) {
      if (error instanceof DerivedGrantImmutableError) {
        return { status: 409, body: { message: error.message } };
      }
      throw error;
    }
    if (removed === null || !removed) {
      return notFound();
    }
    return {
      status: 200,
      body: { ok: true as const },
      audit: { resourceId: params.grantId, details: { userId: params.userId } },
    };
  };

  const grantsVerify: RouteHandler = async (ctx) => {
    const result = await deps.grantVerification.verifyUnverified();
    if (result === null) {
      return {
        status: 503,
        body: { message: "org directory unavailable — is the people module deployed?" },
      };
    }
    ctx.logger.info(
      { verified: result.verified, unresolved: result.unresolved.length },
      "grant verification sweep finished",
    );
    return {
      status: 200,
      body: { verified: result.verified, unresolved: result.unresolved },
      audit: {
        details: { verified: result.verified, unresolvedCount: result.unresolved.length },
      },
    };
  };

  const passwordResetInit: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { userId: string };
    const existing = await deps.users.getUserRecord(params.userId);
    if (existing === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "identity",
      resourceType: "user",
      org: { collegeId: existing.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    const issued = await deps.auth.initiateReset(params.userId, principal.id);
    if (issued === null) {
      return notFound();
    }
    return {
      status: 201,
      // The token appears here ONCE, for the admin. It is never audited or logged.
      body: { token: issued.token, expiresAt: issued.expiresAt.toISOString() },
      headers: { "cache-control": "no-store" },
      audit: {
        resourceId: params.userId,
        details: { expiresAt: issued.expiresAt.toISOString() },
      },
    };
  };

  const passwordSet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { userId: string };
    const body = ctx.request.body as { newPassword: string };
    const existing = await deps.users.getUserRecord(params.userId);
    if (existing === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "identity",
      resourceType: "user",
      org: { collegeId: existing.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    const ok = await deps.auth.adminSetPassword(params.userId, body.newPassword);
    if (!ok) {
      return notFound();
    }
    return {
      status: 200,
      body: { ok: true as const },
      headers: { "cache-control": "no-store" },
      // The new password itself is deliberately absent from the audit detail.
      audit: { resourceId: params.userId },
    };
  };

  return {
    "identity.login": login,
    "identity.logout": logout,
    "identity.session": session,
    "identity.password-change": passwordChange,
    "identity.password-reset-confirm": passwordResetConfirm,
    "identity.user-create": userCreate,
    "identity.user-list": userList,
    "identity.user-get": userGet,
    "identity.user-update": userUpdate,
    "identity.roles-set": rolesSet,
    "identity.grant-add": grantAdd,
    "identity.grant-remove": grantRemove,
    "identity.grants-verify": grantsVerify,
    "identity.password-reset-init": passwordResetInit,
    "identity.password-set": passwordSet,
  };
}
