import type { ZodTypeAny } from "zod";
import type { AccessPolicy, Authenticator, Principal } from "../auth/types";
import type { AuditLogger } from "../audit/types";
import type { Logger } from "../logger/logger";
import type { Metrics } from "../metrics/metrics";
import {
  STATE_CHANGING_METHODS,
  type RouteHandler,
  type RouteResult,
  type RouteSpec,
} from "../contracts/module";
import { problemResponse } from "./problem";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

export interface HttpGuardOptions {
  /**
   * Origins allowed to make state-changing requests in addition to the
   * request's own origin (CSRF defense layer 2; layer 1 is the
   * SameSite=Strict session cookie — ADR-0011).
   */
  readonly trustedOrigins: readonly string[];
  /** Maximum accepted request-body size in bytes (413 beyond it). */
  readonly bodyMaxBytes: number;
}

export const DEFAULT_HTTP_GUARDS: HttpGuardOptions = {
  trustedOrigins: [],
  bodyMaxBytes: 1_048_576,
};

export interface RouteDependencies {
  readonly logger: Logger;
  readonly authenticator: Authenticator;
  readonly accessPolicy: AccessPolicy;
  readonly auditLogger: AuditLogger;
  readonly metrics: Metrics;
  /** Omit to use DEFAULT_HTTP_GUARDS. */
  readonly http?: HttpGuardOptions;
}

/** Second argument mirrors Next.js route-handler context (async params). */
export interface RouteHandlerContext {
  readonly params?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export type BoundRouteHandler = (
  request: Request,
  context?: RouteHandlerContext,
) => Promise<Response>;

interface ValidationOutcome {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly issues?: { path: string; message: string }[];
}

function validate(schema: ZodTypeAny, input: unknown): ValidationOutcome {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    })),
  };
}

function toResponse(result: RouteResult, requestId: string): Response {
  const headers: Record<string, string> = {
    [REQUEST_ID_HEADER]: requestId,
    ...result.headers,
  };
  if (result.contentType !== undefined) {
    headers["content-type"] = result.contentType;
    return new Response(typeof result.body === "string" ? result.body : "", {
      status: result.status,
      headers,
    });
  }
  headers["content-type"] = "application/json";
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
    status: result.status,
    headers,
  });
}

/**
 * Builds the standard request pipeline around a module route handler:
 *
 *   request id → origin guard (state-changing) → authentication gate →
 *   authorization (role requirement) → zod validation (params/query/body,
 *   size-capped) → handler → audit (state-changing) → metrics + access log
 *
 * Security posture (Constitution rule 6): authentication runs unless the
 * RouteSpec explicitly declares itself public. Audit posture (rule 7):
 * state-changing specs must declare an audit action, and a failed audit
 * write fails the request (fail-closed).
 */
export function defineRoute(
  spec: RouteSpec,
  handler: RouteHandler,
  deps: RouteDependencies,
): BoundRouteHandler {
  if (STATE_CHANGING_METHODS.has(spec.method) && spec.audit === undefined) {
    throw new Error(
      `route "${spec.id}": ${spec.method} routes must declare an audit action (Constitution rule 7)`,
    );
  }
  const guards = deps.http ?? DEFAULT_HTTP_GUARDS;

  return async (request: Request, context?: RouteHandlerContext): Promise<Response> => {
    const requestId = resolveRequestId(request.headers);
    const log = deps.logger.child({ requestId, route: spec.id, method: spec.method });
    const startedAt = performance.now();
    let status = 500;
    let principal: Principal | null = null;

    const finish = (response: Response): Response => {
      status = response.status;
      const seconds = (performance.now() - startedAt) / 1000;
      const labels = {
        module: spec.module,
        route: spec.id,
        method: spec.method,
        status: String(status),
      };
      deps.metrics.httpRequestDurationSeconds.observe(labels, seconds);
      deps.metrics.httpRequestsTotal.inc(labels);
      log.info(
        {
          status,
          durationMs: Math.round(seconds * 1000),
          actorId: principal?.id ?? null,
        },
        "request completed",
      );
      return response;
    };

    try {
      if (STATE_CHANGING_METHODS.has(spec.method)) {
        const origin = request.headers.get("origin");
        if (origin !== null) {
          const allowed = new Set([...guards.trustedOrigins, new URL(request.url).origin]);
          if (!allowed.has(origin)) {
            log.warn({ origin }, "request rejected: untrusted cross-origin");
            return finish(
              problemResponse({
                status: 403,
                title: "Cross-origin request rejected",
                requestId,
              }),
            );
          }
        }
      }

      if (!spec.auth.public) {
        const authn = await deps.authenticator.authenticate({
          headers: request.headers,
          method: spec.method,
          path: spec.path,
          requestId,
        });
        if (!authn.authenticated) {
          log.warn({ reason: authn.reason }, "request rejected: unauthenticated");
          return finish(
            problemResponse({
              status: 401,
              title: "Authentication required",
              requestId,
              headers:
                authn.challenge !== undefined
                  ? { "www-authenticate": authn.challenge }
                  : undefined,
            }),
          );
        }
        principal = authn.principal;
        const authz = await deps.accessPolicy.authorize(principal, spec.auth.requirement, {
          module: spec.module,
          routeId: spec.id,
          requestId,
        });
        if (!authz.granted) {
          log.warn({ actorId: principal.id, reason: authz.reason }, "request rejected: forbidden");
          return finish(
            problemResponse({ status: 403, title: "Access denied", requestId }),
          );
        }
      }

      let params: unknown;
      if (spec.request?.params !== undefined) {
        const raw = context?.params === undefined ? {} : await context.params;
        const outcome = validate(spec.request.params, raw);
        if (!outcome.ok) {
          return finish(
            problemResponse({
              status: 400,
              title: "Invalid path parameters",
              requestId,
              issues: outcome.issues,
            }),
          );
        }
        params = outcome.value;
      }

      let query: unknown;
      if (spec.request?.query !== undefined) {
        const url = new URL(request.url);
        const raw = Object.fromEntries(url.searchParams.entries());
        const outcome = validate(spec.request.query, raw);
        if (!outcome.ok) {
          return finish(
            problemResponse({
              status: 400,
              title: "Invalid query parameters",
              requestId,
              issues: outcome.issues,
            }),
          );
        }
        query = outcome.value;
      }

      let body: unknown;
      if (spec.request?.body !== undefined) {
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > guards.bodyMaxBytes) {
          return finish(
            problemResponse({
              status: 413,
              title: "Request body too large",
              requestId,
            }),
          );
        }
        let text: string;
        try {
          text = await request.text();
        } catch {
          text = "";
        }
        if (text.length > guards.bodyMaxBytes) {
          return finish(
            problemResponse({
              status: 413,
              title: "Request body too large",
              requestId,
            }),
          );
        }
        let raw: unknown;
        try {
          raw = JSON.parse(text) as unknown;
        } catch {
          return finish(
            problemResponse({
              status: 400,
              title: "Request body is not valid JSON",
              requestId,
            }),
          );
        }
        const outcome = validate(spec.request.body, raw);
        if (!outcome.ok) {
          return finish(
            problemResponse({
              status: 400,
              title: "Invalid request body",
              requestId,
              issues: outcome.issues,
            }),
          );
        }
        body = outcome.value;
      }

      const result = await handler({
        requestId,
        logger: log,
        principal,
        request: { params, query, body, headers: request.headers },
      });

      if (
        spec.audit !== undefined &&
        STATE_CHANGING_METHODS.has(spec.method) &&
        result.status < 400
      ) {
        const actorOverride = result.audit?.actor;
        await deps.auditLogger.record({
          module: spec.module,
          action: spec.audit.action,
          actorType:
            actorOverride?.type ?? (principal === null ? "system" : principal.kind),
          actorId: actorOverride !== undefined ? actorOverride.id : (principal?.id ?? null),
          resourceType: spec.audit.resourceType,
          resourceId: result.audit?.resourceId ?? null,
          requestId,
          details: {
            routeId: spec.id,
            status: result.status,
            ...result.audit?.details,
          },
        });
      }

      return finish(toResponse(result, requestId));
    } catch (error) {
      log.error({ err: error }, "unhandled route error");
      return finish(
        problemResponse({
          status: 500,
          title: "Internal server error",
          requestId,
        }),
      );
    }
  };
}
