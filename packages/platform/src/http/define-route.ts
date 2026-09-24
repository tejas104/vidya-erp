import type { ZodTypeAny } from "zod";
import type { AccessPolicy, Authenticator, Principal } from "../auth/types";
import type { AuditLogger } from "../audit/types";
import { isDurableAuditReceipt } from "../audit/durable-receipt";
import type { Logger } from "../logger/logger";
import type { Metrics } from "../metrics/metrics";
import {
  STATE_CHANGING_METHODS,
  type RouteHandler,
  type RouteRateLimitIdentifier,
  type RouteResult,
  type RouteSpec,
} from "../contracts/module";
import type { RateLimiter } from "../ratelimit/limiter";
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

/**
 * Ceiling for routes that declare RouteSpec.bodyMaxBytes because their body
 * is an upload rather than an ordinary JSON call (#10.5 Part 3). Sized above
 * the largest real payload found in the schemas — people.document-upload's
 * base64 field caps at 7,000,000 chars (~7 MB; the handler separately
 * enforces the true 5 MB file-size limit) — with headroom to spare.
 */
export const UPLOAD_BODY_MAX_BYTES = 8 * 1024 * 1024;

export interface RouteDependencies {
  readonly logger: Logger;
  readonly authenticator: Authenticator;
  readonly accessPolicy: AccessPolicy;
  readonly auditLogger: AuditLogger;
  readonly metrics: Metrics;
  /** Omit to use DEFAULT_HTTP_GUARDS. */
  readonly http?: HttpGuardOptions;
  /**
   * Omit to disable rate limiting entirely (e.g. lightweight test harnesses).
   * Production composition roots must supply a Redis-backed one —
   * packages/platform/src/ratelimit.
   */
  readonly rateLimiter?: RateLimiter;
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
    // Binary artifacts (e.g. a report PDF) pass through as bytes; text
    // bodies as strings; anything else becomes empty. The copy re-backs the
    // bytes with a plain ArrayBuffer so they satisfy the Response BodyInit type.
    const body =
      typeof result.body === "string"
        ? result.body
        : result.body instanceof Uint8Array
          ? new Uint8Array(result.body)
          : "";
    return new Response(body, { status: result.status, headers });
  }
  headers["content-type"] = "application/json";
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
    status: result.status,
    headers,
  });
}

/**
 * Best-effort client address for rate-limit keying. Mirrors identity's own
 * throttle-keying convention (docs/threat-model-identity.md#throttle-keying):
 * behind the on-prem reverse proxy the first x-forwarded-for hop is
 * proxy-controlled and trustworthy; direct connections share one bucket.
 *
 * The first-hop assumption rests on the Caddyfile declaring NO
 * `trusted_proxies`: an untrusted peer makes Caddy replace a client-supplied
 * XFF with the real remote address rather than append to it. Declare
 * trusted_proxies (or expose the app without the proxy) and a client-forged
 * value lands in first position, handing every per-IP limiter a fresh bucket
 * per request. Change which hop this reads at the same time, or not at all.
 */
function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") {
      return first;
    }
  }
  return "direct";
}

/** Pulls the per-identifier rate-limit subject out of whichever place the RouteSpec says it lives. */
function extractIdentifier(
  identifier: RouteRateLimitIdentifier,
  ctx: { readonly params: unknown; readonly body: unknown; readonly principal: Principal | null },
): string | undefined {
  switch (identifier.source) {
    case "body": {
      const value = (ctx.body as Record<string, unknown> | undefined)?.[identifier.field];
      return typeof value === "string" ? value.toLowerCase() : undefined;
    }
    case "param": {
      const value = (ctx.params as Record<string, unknown> | undefined)?.[identifier.field];
      return typeof value === "string" ? value : undefined;
    }
    case "principal":
      return ctx.principal?.id;
  }
}

/**
 * ADR-0026: true only when the handler proved, through the typed
 * RouteResult.audit.persisted contract, that its own transaction already
 * durably recorded this route's declared audit action for this request. The
 * claim is verified here, never trusted: an unrecognised receipt, or one for
 * a different module/action/resource type/request, is ignored and the
 * ordinary fail-closed audit write still runs (a duplicate is recoverable, a
 * missing audit row is not). Nothing in the request can influence this — the
 * receipt is a server-side object recognised by identity.
 */
function auditAlreadyPersisted(
  spec: RouteSpec,
  requestId: string,
  result: RouteResult,
  log: Logger,
): boolean {
  const persisted = result.audit?.persisted;
  if (persisted === undefined || spec.audit === undefined) return false;
  if (persisted.kind === "idempotent-replay") {
    log.info({ resourceId: persisted.resourceId }, "idempotent replay: no new audit event");
    return true;
  }
  const receipt = persisted.receipt;
  const matches =
    isDurableAuditReceipt(receipt) &&
    receipt.module === spec.module &&
    receipt.action === spec.audit.action &&
    receipt.resourceType === spec.audit.resourceType &&
    receipt.requestId === requestId;
  if (!matches) {
    log.error(
      { declaredAction: spec.audit.action },
      "transactional audit receipt rejected; falling back to the post-handler audit write",
    );
  }
  return matches;
}

function rateLimitedResponse(requestId: string, retryAfterSeconds: number): Response {
  return problemResponse({
    status: 429,
    title: "Too many requests",
    requestId,
    headers: { "retry-after": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}

/**
 * Builds the standard request pipeline around a module route handler:
 *
 *   request id → origin guard (state-changing) → per-IP rate limit (scoped
 *   routes) → authentication gate → global per-session rate limit →
 *   authorization (role requirement) → zod validation (params/query/body,
 *   size-capped to RouteSpec.bodyMaxBytes or the global default) →
 *   per-identifier rate limit (scoped routes) → handler →
 *   audit (declared writes and disclosures) → metrics + access log
 *
 * Security posture (Constitution rule 6): authentication runs unless the
 * RouteSpec explicitly declares itself public. Audit posture (rule 7):
 * state-changing specs must declare an audit action, and a failed audit
 * write fails the request (fail-closed). Rate-limit posture (#10.5 Part 1):
 * ONE middleware, here, backed by Redis with TTL'd counters — no module
 * hand-rolls its own limiting. The per-IP and per-identifier checks for a
 * scope are independent counters; either tripping alone yields 429.
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

      if (spec.rateLimit !== undefined && deps.rateLimiter !== undefined) {
        const ip = clientIp(request.headers);
        const ipDecision = await deps.rateLimiter.checkIp(spec.rateLimit.scope, ip);
        if (ipDecision.limited) {
          log.warn({ scope: spec.rateLimit.scope, ip }, "request rejected: rate limited (ip)");
          return finish(rateLimitedResponse(requestId, ipDecision.retryAfterSeconds));
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
        if (deps.rateLimiter !== undefined && principal.sessionId !== null) {
          const sessionDecision = await deps.rateLimiter.checkSession(principal.sessionId);
          if (sessionDecision.limited) {
            log.warn({ actorId: principal.id }, "request rejected: rate limited (session)");
            return finish(rateLimitedResponse(requestId, sessionDecision.retryAfterSeconds));
          }
        }
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
        const bodyMaxBytes = spec.bodyMaxBytes ?? guards.bodyMaxBytes;
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > bodyMaxBytes) {
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
        if (text.length > bodyMaxBytes) {
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

      if (spec.rateLimit?.identifier !== undefined && deps.rateLimiter !== undefined) {
        const identifierValue = extractIdentifier(spec.rateLimit.identifier, { params, body, principal });
        if (identifierValue !== undefined) {
          const identifierDecision = await deps.rateLimiter.checkIdentifier(
            spec.rateLimit.scope,
            identifierValue,
          );
          if (identifierDecision.limited) {
            log.warn({ scope: spec.rateLimit.scope }, "request rejected: rate limited (identifier)");
            return finish(rateLimitedResponse(requestId, identifierDecision.retryAfterSeconds));
          }
        }
      }

      const result = await handler({
        requestId,
        logger: log,
        principal,
        request: { params, query, body, headers: request.headers },
      });

      if (
        spec.audit !== undefined &&
        result.status < 400 &&
        !auditAlreadyPersisted(spec, requestId, result, log)
      ) {
        const actorOverride = result.audit?.actor;
        await deps.auditLogger.record({
          org: result.audit?.org,
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
