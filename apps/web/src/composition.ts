import {
  DenyAllAccessPolicy,
  DenyAllAuthenticator,
  Lifecycle,
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
  type RuntimeModule,
} from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";

/**
 * COMPOSITION ROOT — web process.
 *
 * The single place where the platform and the feature modules meet for the
 * web replica: builds infrastructure, instantiates each module through its
 * public factory, and binds every declared RouteSpec to the defineRoute
 * pipeline. Route files under app/ contain no logic — they look up their
 * bound handler by route id.
 *
 * AUTH POSTURE (Vidya #1): DenyAllAuthenticator + DenyAllAccessPolicy.
 * Every non-public route answers 401. Vidya #2 swaps these two bindings for
 * the session authenticator and the human-authored scope policy — this file
 * is the only place that changes.
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

  const modules: RuntimeModule<unknown>[] = [system];

  const routeDeps: RouteDependencies = {
    logger,
    authenticator: new DenyAllAuthenticator(),
    accessPolicy: new DenyAllAccessPolicy(),
    auditLogger: system.service.audit,
    metrics,
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
 * pipeline-wrapped handler.
 */
export function routeHandler(routeId: string): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const runtime = getWebRuntime();
    const handler = runtime.handlers[routeId];
    if (handler === undefined) {
      throw new Error(`no route registered with id "${routeId}"`);
    }
    return handler(request);
  };
}
