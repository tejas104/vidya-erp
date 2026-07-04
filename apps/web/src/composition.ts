import {
  Lifecycle,
  RoleRequirementPolicy,
  assertModuleWiring,
  createDb,
  createLogger,
  createMetrics,
  createObjectStorage,
  createRedis,
  defineRoute,
  loadConfig,
  pingPostgres,
  pingRedis,
  type BoundRouteHandler,
  type Logger,
  type RouteDependencies,
  type RouteHandlerContext,
  type RuntimeModule,
} from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";
import { createIdentityCore, createIdentityModule } from "@vidya/module-identity";

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

  const identityCore = createIdentityCore({
    redis,
    session: {
      ttlHours: config.identity.session.ttlHours,
      idleMinutes: config.identity.session.idleMinutes,
    },
  });
  const identity = createIdentityModule({
    db,
    redis,
    metrics,
    audit: system.service.audit,
    core: identityCore,
    config: config.identity,
  });

  const modules: RuntimeModule<unknown>[] = [system, identity];

  const routeDeps: RouteDependencies = {
    logger,
    authenticator: identity.service.authenticator,
    accessPolicy: new RoleRequirementPolicy(),
    auditLogger: system.service.audit,
    metrics,
    http: config.http,
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
  return { handlers, lifecycle, logger };
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
