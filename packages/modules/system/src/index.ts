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
  type TransactionalAuditLogger,
  type Db,
  type LicenseStatus,
  type Metrics,
  type ReadinessCheck,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import { createSystemHandlers } from "./api/handlers";
import {
  readAuditEventsByAction,
  readAuditEventsForResource,
  readRecentAuditEvents,
  readScopedAuditEvents,
  SystemAuditLogger,
  type AuditLogRecord,
} from "./service/audit-writer";
import { createPreferencesStore } from "./service/preferences";
import { createClockWatermark, type ClockDecision } from "./service/clock-watermark";
import { seatOverage, type SeatOverage } from "./service/seat-usage";
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
export { seatOverage };
export type { AuditLogRecord, HeartbeatPayload, ClockDecision, SeatOverage };

/** What other modules (and composition roots) may call on this module. */
export interface SystemService {
  /** The application-wide audit sink (Constitution rule 7). */
  readonly audit: TransactionalAuditLogger;
  /** Operational read-back of recent audit events, newest first. */
  readRecentAuditEvents(limit: number): Promise<AuditLogRecord[]>;
  /** One resource's change history (e.g. a mark's grade changes), newest first. */
  readAuditEventsForResource(
    resourceType: string,
    resourceId: string,
    limit: number,
  ): Promise<AuditLogRecord[]>;
  /** Recent events for one action college-wide, newest first (e.g. a corrections queue). */
  readAuditEventsByAction(action: string, limit: number): Promise<AuditLogRecord[]>;
  /**
   * Reads the monotonic high-water date mark, advances it when the wall clock
   * has moved forward, and reports a regression beyond tolerance (licence
   * design spec, DECISION 2). Called once by the composition root at boot.
   */
  observeClock(now: Date): Promise<ClockDecision>;
}

export interface SystemModuleDeps {
  readonly scopeChecker?: ScopeChecker;
  readonly db: Db;
  readonly metrics: Metrics;
  readonly serviceVersion: string;
  readonly isDraining: () => boolean;
  /** Postgres/Redis reachability checks supplied by the composition root. */
  readonly infrastructureChecks: readonly ReadinessCheck[];
  /**
   * Verified at boot by the composition root (#12 step 4); presentation only.
   *
   * A getter, not a value: the DECISION 2 clock check is a database read and
   * the composition root is synchronous, so a rolled-back clock re-verifies
   * the licence moments AFTER this module is constructed. Reading it lazily
   * means the System page and the banner pick that up without the module
   * having to be rebuilt.
   */
  readonly license: () => LicenseStatus;
  /** Late-bound from the people module — system is composed before people (#11.75 item 1). */
  readonly countActiveStudents: () => Promise<number>;
}

export function createSystemModule(deps: SystemModuleDeps): RuntimeModule<SystemService> {
  const audit = new SystemAuditLogger(deps.db);
  const clockWatermark = createClockWatermark(deps.db);
  // Bound once, shared by the audit-log route handler and the service surface.
  const recentAuditEvents = (limit: number) => readRecentAuditEvents(deps.db, limit);
  const auditEventsByAction = (action: string, limit: number) => readAuditEventsByAction(deps.db, action, limit);
  const module: RuntimeModule<SystemService> = {
    definition: systemModuleDefinition,
    handlers: createSystemHandlers({
      metrics: deps.metrics,
      serviceVersion: deps.serviceVersion,
      isDraining: deps.isDraining,
      infrastructureChecks: deps.infrastructureChecks,
      preferences: createPreferencesStore(deps.db),
      license: deps.license,
      countActiveStudents: deps.countActiveStudents,
      readScopedAuditEvents: (collegeIds, action, limit) => readScopedAuditEvents(deps.db, collegeIds, action, limit),
      scopeChecker: deps.scopeChecker,
    }),
    jobProcessors: {
      [HEARTBEAT_JOB_NAME]: createHeartbeatProcessor(audit),
    },
    readinessChecks: [],
    service: {
      audit,
      readRecentAuditEvents: recentAuditEvents,
      readAuditEventsForResource: (resourceType: string, resourceId: string, limit: number) =>
        readAuditEventsForResource(deps.db, resourceType, resourceId, limit),
      readAuditEventsByAction: auditEventsByAction,
      observeClock: (now: Date) => clockWatermark.observe(now),
    },
  };
  assertModuleWiring(module);
  return module;
}
