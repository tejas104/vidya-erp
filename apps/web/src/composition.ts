import { readFileSync } from "node:fs";
import {
  LICENSE_PUBLIC_KEY,
  Lifecycle,
  RoleRequirementPolicy,
  assertModuleWiring,
  createDb,
  createLogger,
  createMetrics,
  createModuleQueue,
  createObjectStorage,
  createRateLimiter,
  createRedis,
  defineRoute,
  loadConfig,
  pingPostgres,
  pingRedis,
  verifyLicense,
  type BoundRouteHandler,
  type LicenseStatus,
  type Logger,
  type OrgDirectory,
  type RouteDependencies,
  type RouteHandlerContext,
  type RuntimeModule,
} from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";
import { createIdentityCore, createIdentityModule } from "@vidya/module-identity";
import { IMPORT_JOB_NAME, PEOPLE_MODULE_NAME, createPeopleModule } from "@vidya/module-people";
import { createAcademicsModule } from "@vidya/module-academics";
import {
  ANALYTICS_MODULE_NAME,
  ROLLUP_JOB_NAME,
  createAnalyticsModule,
} from "@vidya/module-analytics";
import {
  REPORTING_MODULE_NAME,
  REPORT_JOB_NAME,
  createReportingModule,
} from "@vidya/module-reporting";
import { createPortalModule } from "@vidya/module-portal";
import { createTimetableModule } from "@vidya/module-timetable";
import { createCourseworkModule } from "@vidya/module-coursework";
import { createSyllabusModule } from "@vidya/module-syllabus";
import { FEES_MODULE_NAME, INVOICE_GENERATE_JOB_NAME, createFeesModule } from "@vidya/module-fees";
import { createNoticesModule } from "@vidya/module-notices";
import { createResultsModule } from "@vidya/module-results";
import { createExamsModule } from "@vidya/module-exams";
import { createLeaveModule } from "@vidya/module-leave";

/**
 * COMPOSITION ROOT — web process.
 *
 * The single place where the platform and the feature modules meet for the
 * web replica: builds infrastructure, instantiates each module through its
 * public factory, and binds every declared RouteSpec to the defineRoute
 * pipeline. Route files under app/ contain no logic — they look up their
 * bound handler by route id.
 *
 * AUTH POSTURE (Vidya #2): the identity module's SessionAuthenticator and
 * the RoleRequirementPolicy replace #1's DenyAll bindings — exactly the
 * two-binding swap the seam was designed for. Record-level authorization
 * is the ScopeChecker, exposed via identity's service to every module.
 *
 * FAIL-CLOSED BOOT: createIdentityCore() throws until the HUMAN-OWNED
 * security core lands (ADR-0012); no process starts half-secured.
 */

export interface WebRuntime {
  readonly handlers: Readonly<Record<string, BoundRouteHandler>>;
  readonly lifecycle: Lifecycle;
  readonly logger: Logger;
  /** Verified once at boot (#12 step 4 dependency). Presentation only — see
   * packages/platform/src/license/verify.ts; nothing reads this to allow or
   * deny a request. */
  readonly license: LicenseStatus;
}

/** VIDYA_LICENSE (inline token) wins; VIDYA_LICENSE_FILE is a path to read
 * it from, for deployments that prefer a mounted secret file. Neither set,
 * or an unreadable file, both resolve to "" — verifyLicense("") is
 * `absent`, never a boot failure. */
function readLicenseToken(): string {
  const inline = process.env.VIDYA_LICENSE;
  if (inline !== undefined && inline !== "") {
    return inline;
  }
  const filePath = process.env.VIDYA_LICENSE_FILE;
  if (filePath === undefined || filePath === "") {
    return "";
  }
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function buildWebRuntime(): WebRuntime {
  const config = loadConfig();
  const logger = createLogger({
    level: config.logLevel,
    serviceName: "vidya-web",
    serviceVersion: config.serviceVersion,
  });
  const metrics = createMetrics({ serviceName: "vidya-web" });
  const lifecycle = new Lifecycle({
    logger,
    drainMs: config.lifecycle.drainMs,
    timeoutMs: config.lifecycle.timeoutMs,
  });

  const { pool, db } = createDb({
    url: config.database.url,
    poolMax: config.database.poolMax,
    logger,
    applicationName: "vidya-web",
  });
  const redis = createRedis({
    url: config.redis.url,
    logger,
    connectionName: "vidya-web",
  });
  const objectStorage = createObjectStorage(config.s3);

  lifecycle.onShutdown("postgres-pool", () => pool.end());
  lifecycle.onShutdown("redis", async () => {
    redis.disconnect();
  });
  lifecycle.onShutdown("object-storage", async () => {
    objectStorage.destroy();
  });

  const system = createSystemModule({
    db,
    metrics,
    serviceVersion: config.serviceVersion,
    isDraining: () => lifecycle.isDraining,
    infrastructureChecks: [
      { name: "postgres", check: () => pingPostgres(pool) },
      { name: "redis", check: () => pingRedis(redis) },
    ],
  });

  // License verification (#12 step 4 dependency): verified ONCE here and
  // stored on the runtime, never re-verified per request. Expiry blocks
  // nothing — LicenseStatus drives presentation (a later task wires the
  // admin banner) and this one boot audit event, full stop. If status is
  // invalid or absent the process still starts; a license problem is never
  // a reason to refuse to boot a college's information system.
  const license = verifyLicense(readLicenseToken(), LICENSE_PUBLIC_KEY, new Date(), config.edition);
  system.service.audit
    .record({
      module: "system",
      action: "system.license-check",
      actorType: "system",
      actorId: null,
      resourceType: "license",
      resourceId: license.kind === "invalid" || license.kind === "absent" ? null : license.claims.id,
      requestId: null,
      details: {
        status: license.kind,
        ...(license.kind === "invalid" ? { reason: license.reason } : {}),
      },
    })
    .catch((error: unknown) => {
      logger.error({ error }, "failed to write boot license-check audit event");
    });

  const identityCore = createIdentityCore({
    redis,
    session: {
      ttlHours: config.identity.session.ttlHours,
      idleMinutes: config.identity.session.idleMinutes,
    },
  });
  // Late-bound: identity ← people is interface-only (OrgDirectory) to keep
  // the package graph acyclic; the target is set right after people exists.
  const orgDirectoryRef: { current: OrgDirectory | null } = { current: null };
  const identity = createIdentityModule({
    db,
    redis,
    metrics,
    logger,
    audit: system.service.audit,
    core: identityCore,
    config: config.identity,
    orgDirectory: () => orgDirectoryRef.current,
  });

  const peopleQueue = createModuleQueue({
    module: PEOPLE_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("people-queue", () => peopleQueue.close());
  const people = createPeopleModule({
    db,
    metrics,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    identityGrants: identity.service.derivedGrants,
    identity: { issueCredential: identity.service.issueCredential },
    storage: { client: objectStorage, bucket: config.s3.bucket },
    enqueueImport: async (payload) => {
      await peopleQueue.queue.add(IMPORT_JOB_NAME, payload);
    },
    edition: config.edition,
  });
  orgDirectoryRef.current = people.service.orgDirectory;

  const academics = createAcademicsModule({
    db,
    metrics,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
    readAudit: async (resourceType, resourceId, limit) =>
      (await system.service.readAuditEventsForResource(resourceType, resourceId, limit)).map(
        (row) => ({
          action: row.action,
          actorId: row.actorId,
          occurredAt: row.occurredAt,
          details: row.details,
        }),
      ),
    readAuditByAction: async (action, limit) =>
      (await system.service.readAuditEventsByAction(action, limit)).map((row) => ({
        action: row.action,
        actorId: row.actorId,
        occurredAt: row.occurredAt,
        details: row.details,
      })),
  });

  const analyticsQueue = createModuleQueue({
    module: ANALYTICS_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("analytics-queue", () => analyticsQueue.close());
  const analytics = createAnalyticsModule({
    db,
    metrics,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    academicsRead: academics.service.readModel,
    peopleDirectory: people.service.directory,
    config: config.analytics,
    enqueueRollup: async (payload) => {
      await analyticsQueue.queue.add(ROLLUP_JOB_NAME, payload);
    },
  });

  // --- timetable --- (before reporting: exams' clash advisory reads it)
  const timetable = createTimetableModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
  });

  // --- results --- (before reporting: it feeds the grade-card source)
  const results = createResultsModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
    marksReadModel: academics.service.readModel,
  });

  // --- exams --- (before reporting: it feeds the hall-ticket source)
  const exams = createExamsModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
    timetableRead: timetable.service.readModel,
  });

  // --- leave --- (no reporting source; approvals only)
  const leave = createLeaveModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
  });

  const reportingQueue = createModuleQueue({
    module: REPORTING_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("reporting-queue", () => reportingQueue.close());
  const reporting = createReportingModule({
    db,
    metrics,
    audit: system.service.audit,
    analyticsRead: analytics.service.readModel,
    sources: { gradeCard: results.service.gradeCard, hallTicket: exams.service.hallTicket },
    storage: { client: objectStorage, bucket: config.s3.bucket },
    enqueueReport: async (payload) => {
      await reportingQueue.queue.add(REPORT_JOB_NAME, payload);
    },
    // #11 B4: the synchronous per-class credential sheet — identity +
    // people, wired independently of the queued flow above.
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
    linkStudentIdentity: people.service.linkStudentIdentity,
    identity: { issueCredential: identity.service.issueCredential },
  });

  // Portal (W1): no tables, no jobs — self-scoped student views composed
  // from people + academics public reads (+ timetable read model).
  // --- coursework ---
  const coursework = createCourseworkModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
    storage: { client: objectStorage, bucket: config.s3.bucket },
  });

  // --- syllabus ---
  const syllabus = createSyllabusModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
  });

  // --- fees ---
  const feesQueue = createModuleQueue({
    module: FEES_MODULE_NAME,
    redisUrl: config.redis.url,
  });
  lifecycle.onShutdown("fees-queue", () => feesQueue.close());
  const fees = createFeesModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
    enqueueGenerate: async (payload) => {
      await feesQueue.queue.add(INVOICE_GENERATE_JOB_NAME, payload);
    },
  });

  // --- notices ---
  const notices = createNoticesModule({
    db,
    audit: system.service.audit,
    scopeChecker: identityCore.scopeChecker,
    peopleDirectory: people.service.directory,
  });

  const portal = createPortalModule({
    peopleDirectory: people.service.directory,
    academicsRead: academics.service.readModel,
    timetableRead: timetable.service.readModel,
  });

  const modules: RuntimeModule<unknown>[] = [
    system,
    identity,
    people,
    academics,
    analytics,
    reporting,
    timetable,
    coursework,
    syllabus,
    fees,
    notices,
    results,
    exams,
    leave,
    portal,
  ];

  // Redis-backed, shared across replicas (#10.5 Part 1) — the same redis
  // client every module already uses, one middleware call site in
  // defineRoute, no per-module hand-rolling.
  const rateLimiter = createRateLimiter(redis, config.rateLimit);

  const routeDeps: RouteDependencies = {
    logger,
    authenticator: identity.service.authenticator,
    accessPolicy: new RoleRequirementPolicy(),
    auditLogger: system.service.audit,
    metrics,
    http: config.http,
    rateLimiter,
  };

  const handlers: Record<string, BoundRouteHandler> = {};
  for (const module of modules) {
    assertModuleWiring(module);
    for (const route of module.definition.routes) {
      if (handlers[route.id] !== undefined) {
        throw new Error(`duplicate route id across modules: "${route.id}"`);
      }
      const moduleHandler = module.handlers[route.id];
      if (moduleHandler === undefined) {
        throw new Error(`module "${module.definition.name}" is missing handler "${route.id}"`);
      }
      handlers[route.id] = defineRoute(route, moduleHandler, routeDeps);
    }
  }

  // In the production container NEXT_MANUAL_SIG_HANDLE=true hands SIGTERM to
  // us: readiness flips to 503 (drain), then pools close (docs/runbook.md).
  // `next dev` keeps its own signal handling.
  if (process.env.NEXT_MANUAL_SIG_HANDLE === "true") {
    lifecycle.attachSignalHandlers();
  }

  logger.info(
    {
      modules: modules.map((module) => module.definition.name),
      routes: Object.keys(handlers),
      env: config.env,
    },
    "web runtime composed",
  );
  return { handlers, lifecycle, logger, license };
}

const runtimeKey = Symbol.for("vidya.web.runtime");
type GlobalWithRuntime = typeof globalThis & { [runtimeKey]?: WebRuntime };

/** Memoized on globalThis so next dev hot reloads reuse pools instead of leaking them. */
export function getWebRuntime(): WebRuntime {
  const holder = globalThis as GlobalWithRuntime;
  holder[runtimeKey] ??= buildWebRuntime();
  return holder[runtimeKey];
}

/**
 * The only export route files use: a lazy binding from a route id to its
 * pipeline-wrapped handler. The second argument carries Next's route
 * context (async path params).
 */
export function routeHandler(
  routeId: string,
): (request: Request, context?: RouteHandlerContext) => Promise<Response> {
  return async (request: Request, context?: RouteHandlerContext): Promise<Response> => {
    const runtime = getWebRuntime();
    const handler = runtime.handlers[routeId];
    if (handler === undefined) {
      throw new Error(`no route registered with id "${routeId}"`);
    }
    return handler(request, context);
  };
}
