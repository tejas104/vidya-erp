/**
 * @vidya/platform — public API.
 *
 * This is shared infrastructure, not a feature module: it owns no business
 * tables (only the platform_migrations journal, see ADR-0008) and it never
 * imports feature modules. Composition roots in apps/ wire the two together.
 */

export { loadConfig, ConfigError, type AppConfig } from "./config/env";
export { createLogger, type Logger, type LoggerOptions } from "./logger/logger";

export {
  STATE_CHANGING_METHODS,
  assertModuleWiring,
  type HttpMethod,
  type JobContext,
  type JobProcessor,
  type JobSpec,
  type ModuleDefinition,
  type ReadinessCheck,
  type RouteAuth,
  type RouteContext,
  type RouteHandler,
  type RouteRequest,
  type RouteResponseSpec,
  type RouteResult,
  type RouteSpec,
  type RuntimeModule,
} from "./contracts/module";

export {
  type AccessPolicy,
  type AccessRequirement,
  type AuthnDecision,
  type AuthnRequest,
  type Authenticator,
  type AuthzContext,
  type AuthzDecision,
  type Principal,
} from "./auth/types";
export { DenyAllAccessPolicy, DenyAllAuthenticator } from "./auth/deny-all";

export { type ActorType, type AuditEvent, type AuditLogger } from "./audit/types";

export {
  defineRoute,
  type BoundRouteHandler,
  type RouteDependencies,
} from "./http/define-route";
export { problemResponse, type Problem, type ProblemOptions } from "./http/problem";
export { REQUEST_ID_HEADER, resolveRequestId } from "./http/request-id";

export { createMetrics, type Metrics, type MetricsOptions } from "./metrics/metrics";

export { createDb, pingPostgres, type Db, type DbHandle, type DbOptions } from "./db/client";
export {
  discoverMigrations,
  migrateDown,
  migrateUp,
  migrationStatus,
  planUp,
  type AppliedMigration,
  type MigrationPair,
  type MigrationStatus,
  type ModuleMigrationSource,
} from "./db/migrator";

export { createRedis, pingRedis, type RedisOptions } from "./redis/client";

export {
  createModuleQueue,
  createModuleWorker,
  createQueueEvents,
  upsertRepeatableJob,
  type CreateQueueOptions,
  type CreateWorkerOptions,
  type QueueEventsHandle,
  type QueueHandle,
  type RegisteredJob,
  type RepeatableJobOptions,
  type WorkerHandle,
} from "./queue/queue";

export {
  createObjectStorage,
  pingObjectStorage,
  type ObjectStorageOptions,
} from "./storage/s3";

export {
  Lifecycle,
  type LifecycleOptions,
  type ShutdownHook,
  type ShutdownSummary,
} from "./lifecycle/shutdown";
