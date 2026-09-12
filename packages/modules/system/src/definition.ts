import { z } from "zod";
import type { JobSpec, ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "system";
export const TABLE_PREFIX = "sys_";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  uptimeSeconds: z.number(),
  version: z.string(),
});

export const readinessCheckResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
});

export const readyResponseSchema = z.object({
  status: z.enum(["ready", "unready", "draining"]),
  checks: z.array(readinessCheckResultSchema),
});

/** Every staff role except student (design spec: the ≤7-day licence warning
 * reaches all staff, not just admin — but a student must never see any
 * licensing state, so student is excluded here rather than the route being
 * open to any authenticated principal). */
const STAFF_ONLY = {
  public: false as const,
  requirement: {
    rolesAnyOf: [
      "admin" as const,
      "principal" as const,
      "hod" as const,
      "class_teacher" as const,
      "teacher" as const,
      "accountant" as const,
    ],
  },
};

/** Admin only. Same shape as identity's ADMIN_ONLY — the audit log carries
 * usernames, IP addresses and user agents (identity.login-failed /
 * login-locked write all three into `details`), so no other staff role may
 * reach it, not even principal. */
const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };

const licenseClaimsSchema = z.object({
  id: z.string(),
  customer: z.string(),
  edition: z.enum(["college", "school"]),
  issuedAt: z.string(),
  expiresAt: z.string(),
  seats: z.number(),
  notBefore: z.string().optional(),
});

/**
 * Mirrors platform's `LicenseStatus` discriminated union plus `studentCount`
 * (active-student seat usage, computed alongside — #11.75 item 1). Surface
 * only: nothing downstream of this route allows or denies anything (see
 * docs/superpowers/specs/2026-08-13-license-verification-design.md).
 */
export const licenseStatusResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("valid"),
    claims: licenseClaimsSchema,
    daysRemaining: z.number(),
    studentCount: z.number(),
  }),
  z.object({
    kind: z.literal("grace"),
    claims: licenseClaimsSchema,
    daysOverdue: z.number(),
    studentCount: z.number(),
  }),
  z.object({
    kind: z.literal("expired"),
    claims: licenseClaimsSchema,
    daysOverdue: z.number(),
    studentCount: z.number(),
  }),
  z.object({
    kind: z.literal("invalid"),
    reason: z.enum(["malformed", "bad-signature", "unsupported-version", "not-yet-valid", "edition-mismatch"]),
    studentCount: z.number(),
  }),
  z.object({ kind: z.literal("absent"), studentCount: z.number() }),
]);

const licenseRoute: RouteSpec = {
  id: "system.license",
  module: MODULE_NAME,
  method: "GET",
  path: "/api/v1/system/license",
  summary: "Current license status and active-student seat usage",
  description:
    "Verified once at boot, never re-verified per request. Feeds the admin banner, the system page, and the all-staff ≤7-day warning (#11.75 item 1). Open to every staff role except student — the UI decides how much of the status each role is shown; a student must never reach this route at all. Presentation only — never used to allow or deny a request.",
  tags: ["system"],
  auth: STAFF_ONLY,
  responses: {
    200: { description: "Current license status", schema: licenseStatusResponseSchema },
  },
};

/** One row of sys_audit_log as the operational reader sees it. */
export const auditEventViewSchema = z.object({
  id: z.number(),
  occurredAt: z.string(),
  module: z.string(),
  action: z.string(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  requestId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
});

export const auditEventsResponseSchema = z.object({
  events: z.array(auditEventViewSchema),
  /** Echoed back so the UI can say "newest N" without re-deriving it. */
  limit: z.number(),
  /** A full page came back — older events exist beyond this window. */
  truncated: z.boolean(),
});

const AUDIT_LIMIT_MAX = 200;

const auditLogRoute: RouteSpec = {
  id: "system.audit-log",
  module: MODULE_NAME,
  method: "GET",
  path: "/api/v1/system/audit",
  summary: "Recent audit events, newest first (admin)",
  description:
    "The read path for sys_audit_log: every security-relevant event (identity.login-failed, identity.login-locked, identity.roles-changed, system.clock-rollback, system.seat-overage, every state-changing route's audit action). Optional `action` narrows to one action. Admin only — rows carry usernames, IP addresses and user agents in `details`, so no other role may read them. Read-only; nothing here changes state.",
  tags: ["system"],
  auth: ADMIN_ONLY,
  request: {
    query: z.object({
      action: z.string().trim().min(1).max(120).optional(),
      limit: z.coerce.number().int().min(1).max(AUDIT_LIMIT_MAX).default(50),
    }),
  },
  responses: {
    200: { description: "Audit events, newest first", schema: auditEventsResponseSchema },
  },
};

const healthRoute: RouteSpec = {
  id: "system.health",
  module: MODULE_NAME,
  method: "GET",
  path: "/api/v1/system/health",
  summary: "Liveness probe",
  description:
    "Reports that the process is up and able to serve requests. Also reachable at the conventional alias /health (Next.js rewrite).",
  tags: ["system"],
  auth: {
    public: true,
    reason: "liveness probes run before any credential exists; exposes no tenant data",
  },
  responses: {
    200: { description: "Process is alive", schema: healthResponseSchema },
  },
};

const readyRoute: RouteSpec = {
  id: "system.ready",
  module: MODULE_NAME,
  method: "GET",
  path: "/api/v1/system/ready",
  summary: "Readiness probe",
  description:
    "Verifies Postgres and Redis are reachable and that the replica is not draining. Alias: /ready.",
  tags: ["system"],
  auth: {
    public: true,
    reason: "readiness probes run before any credential exists; exposes dependency names and boolean state only",
  },
  responses: {
    200: { description: "Replica is ready for traffic", schema: readyResponseSchema },
    503: { description: "Replica is unready or draining", schema: readyResponseSchema },
  },
};

const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

/** Any JSON value — the pipeline has already run the body through
 * JSON.parse, so the shape itself is guaranteed valid JSON; this only needs
 * to reject a missing "value" field (openapi generation can't introspect a
 * recursive z.lazy() union, so this stays a plain "unknown, but present"). */
const jsonValueSchema = z.unknown().refine((value) => value !== undefined, {
  message: "value is required",
});

export const preferenceKeySchema = z.string().trim().min(1).max(128);

export const preferenceViewSchema = z.object({
  key: z.string(),
  value: jsonValueSchema,
  updatedAt: z.string(),
});

const preferenceGetRoute: RouteSpec = {
  id: "system.preference-get",
  module: MODULE_NAME,
  method: "GET",
  path: "/api/v1/system/preferences/{key}",
  summary: "Read one of the caller's own preferences",
  description:
    "Always scoped to the caller's own principal — the user id is never taken from the request. 404 if the caller has never set this key.",
  tags: ["system-preferences"],
  auth: ANY_AUTHENTICATED,
  request: { params: z.object({ key: preferenceKeySchema }) },
  responses: {
    200: { description: "The preference", schema: preferenceViewSchema },
    404: { description: "No such preference for this caller", schema: problemSchema },
  },
};

const preferenceSetRoute: RouteSpec = {
  id: "system.preference-set",
  module: MODULE_NAME,
  method: "PUT",
  path: "/api/v1/system/preferences/{key}",
  summary: "Write one of the caller's own preferences (upsert)",
  description:
    "Always scoped to the caller's own principal — the user id is never taken from the request. Creates the key on first write, overwrites it thereafter.",
  tags: ["system-preferences"],
  auth: ANY_AUTHENTICATED,
  request: {
    params: z.object({ key: preferenceKeySchema }),
    body: z.object({ value: jsonValueSchema }),
  },
  audit: { action: "system.preference-set", resourceType: "user-preference" },
  responses: {
    200: { description: "Stored", schema: preferenceViewSchema },
  },
};

const metricsRoute: RouteSpec = {
  id: "system.metrics",
  module: MODULE_NAME,
  method: "GET",
  path: "/api/v1/system/metrics",
  summary: "Prometheus metrics",
  description:
    "Prometheus text exposition for this replica. Alias: /metrics. Must be network-restricted to the scrape network in production (docs/threat-model.md).",
  tags: ["system"],
  auth: {
    public: true,
    reason: "scraped by Prometheus without credentials in this phase; restrict at the network layer",
  },
  responses: {
    200: {
      description: "Prometheus text exposition (version 0.0.4)",
      contentType: "text/plain; version=0.0.4; charset=utf-8",
    },
  },
};

export const HEARTBEAT_JOB_NAME = "audit-heartbeat";
export const HEARTBEAT_SCHEDULER_ID = "system-heartbeat";

export const heartbeatPayloadSchema = z.object({
  /** Which process/schedule enqueued the beat, e.g. "worker-schedule". */
  source: z.string().min(1),
  note: z.string().max(500).optional(),
});

export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;

const heartbeatJob: JobSpec = {
  name: HEARTBEAT_JOB_NAME,
  module: MODULE_NAME,
  summary:
    "Writes a heartbeat entry to the audit log; proves the enqueue → Redis → worker → Postgres path end to end.",
  payloadSchema: heartbeatPayloadSchema,
};

/**
 * Static module definition — no runtime dependencies, safe for tooling
 * (migration harness, OpenAPI generation, table-ownership checks).
 */
export const systemModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes: [healthRoute, readyRoute, metricsRoute, preferenceGetRoute, preferenceSetRoute, licenseRoute, auditLogRoute],
  jobs: [heartbeatJob],
};
