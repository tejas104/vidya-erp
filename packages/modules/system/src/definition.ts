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
  routes: [healthRoute, readyRoute, metricsRoute],
  jobs: [heartbeatJob],
};
