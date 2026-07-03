/**
 * @vidya/module-system — PUBLIC API (the only importable surface).
 *
 * The reference implementation of the Vidya module contract:
 *  - static definition (routes, jobs, table ownership, migrations dir),
 *  - factory returning the runtime module,
 *  - public service API (audit seam + audit read-back).
 *
 * Everything under src/ other than this file is module-internal; the
 * boundary lint and the package exports map both block deep imports.
 */

import {
  assertModuleWiring,
  type AuditLogger,
  type Db,
  type Metrics,
  type ReadinessCheck,
  type RuntimeModule,
} from "@vidya/platform";
import { createSystemHandlers } from "./api/handlers";
import { readRecentAuditEvents, SystemAuditLogger, type AuditLogRecord } from "./service/audit-writer";
import { createHeartbeatProcessor } from "./jobs/heartbeat";
import {
  HEARTBEAT_JOB_NAME,
  HEARTBEAT_SCHEDULER_ID,
  MODULE_NAME,
  heartbeatPayloadSchema,
  systemModuleDefinition,
  type HeartbeatPayload,
} from "./definition";

export {
  HEARTBEAT_JOB_NAME,
  HEARTBEAT_SCHEDULER_ID,
  MODULE_NAME as SYSTEM_MODULE_NAME,
  heartbeatPayloadSchema,
  systemModuleDefinition,
};
export type { AuditLogRecord, HeartbeatPayload };

/** What other modules (and composition roots) may call on this module. */
export interface SystemService {
  /** The application-wide audit sink (Constitution rule 7). */
  readonly audit: AuditLogger;
  /** Operational read-back of recent audit events, newest first. */
  readRecentAuditEvents(limit: number): Promise<AuditLogRecord[]>;
}

export interface SystemModuleDeps {
  readonly db: Db;
  readonly metrics: Metrics;
  readonly serviceVersion: string;
  readonly isDraining: () => boolean;
  /** Postgres/Redis reachability checks supplied by the composition root. */
  readonly infrastructureChecks: readonly ReadinessCheck[];
}

export function createSystemModule(deps: SystemModuleDeps): RuntimeModule<SystemService> {
  const audit = new SystemAuditLogger(deps.db);
  const module: RuntimeModule<SystemService> = {
    definition: systemModuleDefinition,
    handlers: createSystemHandlers({
      metrics: deps.metrics,
      serviceVersion: deps.serviceVersion,
      isDraining: deps.isDraining,
      infrastructureChecks: deps.infrastructureChecks,
    }),
    jobProcessors: {
      [HEARTBEAT_JOB_NAME]: createHeartbeatProcessor(audit),
    },
    readinessChecks: [],
    service: {
      audit,
      readRecentAuditEvents: (limit: number) => readRecentAuditEvents(deps.db, limit),
    },
  };
  assertModuleWiring(module);
  return module;
}
