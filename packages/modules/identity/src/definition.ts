import { z } from "zod";
import { ROLES, type JobSpec, type ModuleDefinition, type RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "identity";
export const TABLE_PREFIX = "idn_";

// ---------------------------------------------------------------------------
// Shared schemas (also the OpenAPI source — ADR-0007)
// ---------------------------------------------------------------------------

export const roleSchema = z.enum(ROLES);

/** Opaque org identifier under the #3 identifier contract. */
export const orgIdSchema = z.string().min(1).max(64);

/** Password policy: length is the primary control (NIST 800-63B). */
export const passwordSchema = z.string().min(12).max(256);

export const usernameSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9._@-]+$/i, "letters, digits and . _ @ - only");

export const grantInputSchema = z
  .object({
    role: roleSchema,
    collegeId: orgIdSchema,
    departmentId: orgIdSchema.optional(),
    classId: orgIdSchema.optional(),
    sectionId: orgIdSchema.optional(),
    subjectId: orgIdSchema.optional(),
  })
  .superRefine((grant, ctx) => {
    // Mirrors idn_scope_grants_path_check / _shape_check (ADR-0010).
    if (grant.sectionId !== undefined && grant.classId === undefined) {
      ctx.addIssue({ code: "custom", path: ["sectionId"], message: "sectionId requires classId" });
    }
    if (grant.classId !== undefined && grant.departmentId === undefined) {
      ctx.addIssue({ code: "custom", path: ["classId"], message: "classId requires departmentId" });
    }
    switch (grant.role) {
      case "teacher":
        if (grant.subjectId === undefined) {
          ctx.addIssue({ code: "custom", path: ["subjectId"], message: "teacher grants require a subjectId" });
        }
        if (grant.classId === undefined) {
          ctx.addIssue({ code: "custom", path: ["classId"], message: "teacher grants target a class or section" });
        }
        break;
      case "class_teacher":
        if (grant.subjectId !== undefined) {
          ctx.addIssue({ code: "custom", path: ["subjectId"], message: "class_teacher grants carry no subject" });
        }
        if (grant.classId === undefined) {
          ctx.addIssue({ code: "custom", path: ["classId"], message: "class_teacher grants target a class or section" });
        }
        break;
      case "hod":
        if (grant.departmentId === undefined) {
          ctx.addIssue({ code: "custom", path: ["departmentId"], message: "hod grants target a department" });
        }
        if (grant.classId !== undefined || grant.sectionId !== undefined || grant.subjectId !== undefined) {
          ctx.addIssue({ code: "custom", path: ["role"], message: "hod grants must not narrow below department" });
        }
        break;
      case "principal":
      case "admin":
        if (
          grant.departmentId !== undefined ||
          grant.classId !== undefined ||
          grant.sectionId !== undefined ||
          grant.subjectId !== undefined
        ) {
          ctx.addIssue({ code: "custom", path: ["role"], message: `${grant.role} grants are college-wide only` });
        }
        break;
      case "student":
        // Students are self-scoped via the people-module identity link (W1) —
        // they never hold org grants; access authority is the link itself.
        ctx.addIssue({ code: "custom", path: ["role"], message: "student access is self-scoped; no grants" });
        break;
      case "accountant":
        // College-wide like principal/admin; writes are confined to the fees
        // module by grantAllows, not by narrowing the grant.
        if (
          grant.departmentId !== undefined ||
          grant.classId !== undefined ||
          grant.sectionId !== undefined ||
          grant.subjectId !== undefined
        ) {
          ctx.addIssue({ code: "custom", path: ["role"], message: "accountant grants are college-wide only" });
        }
        break;
    }
  });

export const grantViewSchema = z.object({
  id: z.string(),
  role: roleSchema,
  collegeId: z.string(),
  departmentId: z.string().nullable(),
  classId: z.string().nullable(),
  sectionId: z.string().nullable(),
  subjectId: z.string().nullable(),
  verified: z.boolean(),
  source: z.enum(["manual", "derived"]),
});

export const userViewSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  status: z.enum(["active", "disabled", "must_reset"]),
  collegeId: z.string(),
  roles: z.array(roleSchema),
  grants: z.array(grantViewSchema),
  createdAt: z.string(),
});

export const sessionViewSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  roles: z.array(roleSchema),
  grants: z.array(
    z.object({
      role: roleSchema,
      org: z.object({
        collegeId: z.string(),
        departmentId: z.string().optional(),
        classId: z.string().optional(),
        sectionId: z.string().optional(),
      }),
      subjectId: z.string().optional(),
    }),
  ),
});

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const userIdParams = z.object({ userId: z.string().min(1).max(64) });

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

const routes: RouteSpec[] = [
  {
    id: "identity.login",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/identity/auth/login",
    summary: "Log in with username and password",
    description:
      "Issues a Redis-backed session (HttpOnly cookie). Throttled per user+IP; repeated failures lock the account window. Successful logins audit with the authenticated user as actor; failures are audited by the service.",
    tags: ["identity"],
    auth: { public: true, reason: "credential establishment — the caller has no session yet" },
    request: {
      body: z.object({ username: usernameSchema, password: z.string().min(1).max(256) }),
    },
    audit: { action: "identity.login", resourceType: "session" },
    responses: {
      200: {
        description: "Session issued; Set-Cookie header carries the session token",
        schema: z.object({
          user: z.object({ id: z.string(), displayName: z.string(), roles: z.array(roleSchema) }),
          expiresAt: z.string(),
        }),
      },
      401: { description: "Invalid credentials (uniform for unknown user / wrong password / disabled account)", schema: problemSchema },
      403: { description: "Password reset required before login", schema: problemSchema },
      429: { description: "Too many failed attempts; retry after the lockout window", schema: problemSchema },
    },
  },
  {
    id: "identity.logout",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/identity/auth/logout",
    summary: "Log out (invalidate the current session)",
    tags: ["identity"],
    auth: ANY_AUTHENTICATED,
    audit: { action: "identity.logout", resourceType: "session" },
    responses: {
      200: { description: "Session invalidated; cookie cleared", schema: z.object({ ok: z.literal(true) }) },
    },
  },
  {
    id: "identity.session",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/identity/auth/session",
    summary: "Describe the current session (whoami)",
    tags: ["identity"],
    auth: ANY_AUTHENTICATED,
    responses: { 200: { description: "Current principal", schema: sessionViewSchema } },
  },
  {
    id: "identity.password-change",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/identity/auth/password/change",
    summary: "Change own password",
    description: "Requires the current password. Invalidates every session of the user.",
    tags: ["identity"],
    auth: ANY_AUTHENTICATED,
    request: {
      body: z.object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema }),
    },
    audit: { action: "identity.password-changed", resourceType: "user" },
    responses: {
      200: { description: "Password changed; all sessions invalidated", schema: z.object({ ok: z.literal(true) }) },
      401: { description: "Current password incorrect", schema: problemSchema },
    },
  },
  {
    id: "identity.password-reset-confirm",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/identity/auth/password-reset/confirm",
    summary: "Redeem a one-time reset token and set a new password",
    description:
      "Tokens are admin-issued (no self-service email flow until the notifications module exists — ADR-0011), single-use, short-TTL. Invalidates every session of the user.",
    tags: ["identity"],
    auth: { public: true, reason: "the caller has no session — possession of the one-time token is the credential" },
    request: {
      body: z.object({ token: z.string().min(32).max(256), newPassword: passwordSchema }),
    },
    audit: { action: "identity.password-reset-completed", resourceType: "user" },
    responses: {
      200: { description: "Password set; account active; sessions invalidated", schema: z.object({ ok: z.literal(true) }) },
      401: { description: "Token invalid, expired or already used", schema: problemSchema },
      429: { description: "Too many attempts from this address", schema: problemSchema },
    },
  },
  {
    id: "identity.user-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/identity/users",
    summary: "Create a user (admin)",
    description:
      "Creates the account in must_reset status with a temporary password; the user must complete a password reset before first login.",
    tags: ["identity"],
    auth: ADMIN_ONLY,
    request: {
      body: z.object({
        username: usernameSchema,
        displayName: z.string().min(1).max(128),
        collegeId: orgIdSchema,
        temporaryPassword: passwordSchema,
        roles: z.array(roleSchema).max(5).default([]),
      }),
    },
    audit: { action: "identity.user-created", resourceType: "user" },
    responses: {
      201: { description: "User created", schema: userViewSchema },
      409: { description: "Username already taken", schema: problemSchema },
    },
  },
  {
    id: "identity.user-list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/identity/users",
    summary: "List users of a college (admin)",
    tags: ["identity"],
    auth: ADMIN_ONLY,
    request: {
      query: z.object({
        collegeId: orgIdSchema,
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: {
      200: { description: "Users in the college", schema: z.object({ users: z.array(userViewSchema) }) },
      403: { description: "Admin scope does not cover this college", schema: problemSchema },
    },
  },
  {
    id: "identity.user-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/identity/users/{userId}",
    summary: "Read a user profile (self, or admin within scope)",
    description: "Record-level access is decided by the scope-check chokepoint (self-access rule or admin support-read).",
    tags: ["identity"],
    auth: ANY_AUTHENTICATED,
    request: { params: userIdParams },
    responses: {
      200: { description: "The user", schema: userViewSchema },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such user", schema: problemSchema },
    },
  },
  {
    id: "identity.user-update",
    module: MODULE_NAME,
    method: "PATCH",
    path: "/api/v1/identity/users/{userId}",
    summary: "Update display name or status (admin)",
    tags: ["identity"],
    auth: ADMIN_ONLY,
    request: {
      params: userIdParams,
      body: z
        .object({
          displayName: z.string().min(1).max(128).optional(),
          status: z.enum(["active", "disabled"]).optional(),
        })
        .refine((patch) => patch.displayName !== undefined || patch.status !== undefined, {
          message: "at least one field required",
        }),
    },
    audit: { action: "identity.user-updated", resourceType: "user" },
    responses: {
      200: { description: "Updated user", schema: userViewSchema },
      404: { description: "No such user", schema: problemSchema },
    },
  },
  {
    id: "identity.roles-set",
    module: MODULE_NAME,
    method: "PUT",
    path: "/api/v1/identity/users/{userId}/roles",
    summary: "Replace a user's role memberships (admin)",
    description: "Revoked roles cascade away their scope grants. Invalidates the user's sessions.",
    tags: ["identity"],
    auth: ADMIN_ONLY,
    request: { params: userIdParams, body: z.object({ roles: z.array(roleSchema).max(5) }) },
    audit: { action: "identity.roles-changed", resourceType: "user" },
    responses: {
      200: { description: "New role set", schema: z.object({ roles: z.array(roleSchema) }) },
      404: { description: "No such user", schema: problemSchema },
    },
  },
  {
    id: "identity.grant-add",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/identity/users/{userId}/grants",
    summary: "Add a scope grant (admin)",
    description:
      "Org identifiers follow the #3 contract and are recorded verified=false until the OrgDirectory exists. The user must already hold the grant's role. Invalidates the user's sessions.",
    tags: ["identity"],
    auth: ADMIN_ONLY,
    request: { params: userIdParams, body: grantInputSchema },
    audit: { action: "identity.grant-added", resourceType: "scope-grant" },
    responses: {
      201: { description: "Grant created", schema: grantViewSchema },
      404: { description: "No such user", schema: problemSchema },
      409: { description: "User does not hold the grant's role", schema: problemSchema },
    },
  },
  {
    id: "identity.grant-remove",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/identity/users/{userId}/grants/{grantId}",
    summary: "Remove a scope grant (admin)",
    description: "Invalidates the user's sessions.",
    tags: ["identity"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ userId: z.string().min(1).max(64), grantId: z.string().min(1).max(64) }) },
    audit: { action: "identity.grant-removed", resourceType: "scope-grant" },
    responses: {
      200: { description: "Grant removed", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such user or grant", schema: problemSchema },
    },
  },
  {
    id: "identity.grants-verify",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/identity/grants/verify",
    summary: "Verify unverified scope grants against the org tree (admin)",
    description:
      "Backfill for grants created before the people module existed (#3): checks each verified=false grant's org path and subject against the OrgDirectory, flips resolvable ones to verified, and reports the rest. Grants are never deleted by this run.",
    tags: ["identity"],
    auth: ADMIN_ONLY,
    audit: { action: "identity.grants-verify-run", resourceType: "scope-grant" },
    responses: {
      200: {
        description: "Verification sweep result",
        schema: z.object({
          verified: z.number(),
          unresolved: z.array(z.object({ grantId: z.string(), reason: z.string() })),
        }),
      },
      503: { description: "Org directory unavailable (people module not wired)", schema: problemSchema },
    },
  },
  {
    id: "identity.password-reset-init",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/identity/users/{userId}/password-reset",
    summary: "Issue a one-time password-reset token (admin)",
    description:
      "Returns the token to the ADMIN for out-of-band delivery. The token itself is never logged or audited — only its issuance.",
    tags: ["identity"],
    auth: ADMIN_ONLY,
    request: { params: userIdParams },
    audit: { action: "identity.password-reset-initiated", resourceType: "user" },
    responses: {
      201: {
        description: "One-time token (shown once)",
        schema: z.object({ token: z.string(), expiresAt: z.string() }),
      },
      404: { description: "No such user", schema: problemSchema },
    },
  },
];

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const RESET_CLEANUP_JOB_NAME = "reset-token-cleanup";
export const RESET_CLEANUP_SCHEDULER_ID = "identity-reset-token-cleanup";
export const resetCleanupPayloadSchema = z.object({
  source: z.string().min(1),
});

const jobs: JobSpec[] = [
  {
    name: RESET_CLEANUP_JOB_NAME,
    module: MODULE_NAME,
    summary: "Deletes expired/used password-reset tokens.",
    payloadSchema: resetCleanupPayloadSchema,
  },
];

export const identityModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs,
};
