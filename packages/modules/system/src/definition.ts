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
  routes: [healthRoute, readyRoute, metricsRoute, preferenceGetRoute, preferenceSetRoute],
  jobs: [heartbeatJob],
};
