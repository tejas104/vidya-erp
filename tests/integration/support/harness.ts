/**
 * Integration harness: composes the REAL stack — system + identity (with
 * the human-owned security core: argon2, Redis sessions, the ADR-0010/0013
 * scope matrix) + people — against the integration Postgres/Redis, and
 * binds every route through the real defineRoute pipeline.
 */

import {
  RoleRequirementPolicy,
  createDb,
  createLogger,
  createMetrics,
  createObjectStorage,
  createRedis,
  defineRoute,
  type BoundRouteHandler,
  type OrgDirectory,
  type RouteDependencies,
  type RouteSpec,
} from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";
import { createIdentityCore, createIdentityModule } from "@vidya/module-identity";
import { createPeopleModule } from "@vidya/module-people";

export const ADMIN_USERNAME = "int-admin";
export const ADMIN_PASSWORD = "integration-admin-pass-1";
export const COLLEGE_CODE = "INTC";

export interface CallOptions {
  body?: unknown;
  cookie?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  ip?: string;
}

export function buildStack() {
  const logger = createLogger({ level: "silent", serviceName: "vidya-int" });
  const { pool, db } = createDb({
    url: process.env.DATABASE_URL ?? "",
    poolMax: 5,
    logger,
    applicationName: "vidya-int-harness",
  });
  const redis = createRedis({
    url: process.env.REDIS_URL ?? "",
    logger,
    connectionName: "vidya-int-harness",
  });
  const metrics = createMetrics({ serviceName: "vidya-int", defaultMetrics: false });

  const system = createSystemModule({
    db,
    metrics,
    serviceVersion: "integration",
    isDraining: () => false,
    infrastructureChecks: [],
  });

  const core = createIdentityCore({
    redis,
    session: { ttlHours: 12, idleMinutes: 30 },
  });
  const orgDirectoryRef: { current: OrgDirectory | null } = { current: null };
  const identity = createIdentityModule({
    db,
    redis,
    metrics,
    audit: system.service.audit,
    core,
    config: {
      session: { cookieName: "vidya_session", cookieSecure: false, ttlHours: 12, idleMinutes: 30 },
      resetTokenTtlMinutes: 30,
      throttle: { maxAttempts: 5, windowMinutes: 15 },
    },
    orgDirectory: () => orgDirectoryRef.current,
  });

  const objectStorage = createObjectStorage({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "unused",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "unused",
    forcePathStyle: true,
  });
  const enqueuedImports: { importId: string; source: string }[] = [];
  const people = createPeopleModule({
    db,
    metrics,
    audit: system.service.audit,
    scopeChecker: core.scopeChecker,
    identityGrants: identity.service.derivedGrants,
    storage: { client: objectStorage, bucket: process.env.S3_BUCKET ?? "vidya-int" },
    enqueueImport: async (payload) => {
      enqueuedImports.push(payload);
    },
  });
  orgDirectoryRef.current = people.service.orgDirectory;

  const routeDeps: RouteDependencies = {
    logger,
    authenticator: identity.service.authenticator,
    accessPolicy: new RoleRequirementPolicy(),
    auditLogger: system.service.audit,
    metrics,
  };
  const specs = new Map<string, RouteSpec>();
  const handlers: Record<string, BoundRouteHandler> = {};
  for (const module of [identity, people]) {
    for (const route of module.definition.routes) {
      specs.set(route.id, route);
      handlers[route.id] = defineRoute(route, module.handlers[route.id]!, routeDeps);
    }
  }

  async function call(routeId: string, options: CallOptions = {}): Promise<Response> {
    const route = specs.get(routeId);
    if (route === undefined) {
      throw new Error(`unknown route ${routeId}`);
    }
    const headers: Record<string, string> = { "x-forwarded-for": options.ip ?? "10.1.1.1" };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (options.cookie !== undefined) {
      headers.cookie = options.cookie;
    }
    const query = new URLSearchParams(options.query ?? {}).toString();
    const request = new Request(
      `http://localhost${route.path}${query === "" ? "" : `?${query}`}`,
      {
        method: route.method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      },
    );
    return handlers[routeId]!(request, { params: Promise.resolve(options.params ?? {}) });
  }

  function sessionCookie(response: Response): string {
    const header = response.headers.get("set-cookie") ?? "";
    const token = /vidya_session=([^;]*)/.exec(header)?.[1] ?? "";
    return `vidya_session=${token}`;
  }

  async function login(username: string, password: string): Promise<string> {
    const response = await call("identity.login", { body: { username, password } });
    if (response.status !== 200) {
      throw new Error(`login as ${username} failed with ${response.status}`);
    }
    return sessionCookie(response);
  }

  /**
   * Idempotent bootstrap: the integration college (by code) and its first
   * admin. Survives repeated local runs against a non-reset database.
   */
  async function bootstrap(): Promise<{ collegeId: string; adminCookie: string }> {
    const college = await people.service.bootstrapCollege({
      name: "Integration College",
      code: COLLEGE_CODE,
    });
    try {
      await identity.service.bootstrapAdmin({
        username: ADMIN_USERNAME,
        displayName: "Integration Admin",
        password: ADMIN_PASSWORD,
        collegeId: college.collegeId,
      });
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("bootstrap refused"))) {
        throw error;
      }
    }
    const adminCookie = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    return { collegeId: college.collegeId, adminCookie };
  }

  async function close(): Promise<void> {
    objectStorage.destroy();
    redis.disconnect();
    await pool.end();
  }

  return {
    pool,
    db,
    redis,
    system,
    identity,
    people,
    core,
    enqueuedImports,
    call,
    sessionCookie,
    login,
    bootstrap,
    close,
  };
}

export type Stack = ReturnType<typeof buildStack>;
