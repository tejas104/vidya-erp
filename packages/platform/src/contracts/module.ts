import type { z } from "zod";
import type { Logger } from "../logger/logger";
import type { AccessRequirement, Principal } from "../auth/types";
import type { ActorType } from "../audit/types";

/**
 * THE MODULE CONTRACT.
 *
 * Every feature module exports, from its package's index.ts and nowhere else:
 *   1. a static ModuleDefinition (no runtime dependencies — consumable by
 *      tooling: migration harness, OpenAPI generator, ownership checks), and
 *   2. a factory `create<Name>Module(deps)` returning a RuntimeModule that
 *      binds handlers, job processors and the module's public service API.
 *
 * See docs/how-to-add-a-module.md for the worked example.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Methods that change state and therefore MUST audit (Constitution rule 7). */
export const STATE_CHANGING_METHODS: ReadonlySet<HttpMethod> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Deny-by-default: a route is only public if it says so, with a recorded
 * justification that flows into the OpenAPI spec.
 */
export type RouteAuth =
  | { readonly public: true; readonly reason: string }
  | { readonly public: false; readonly requirement: AccessRequirement };

export interface RouteResponseSpec {
  readonly description: string;
  /** Defaults to application/json. */
  readonly contentType?: string;
  /** Omit for non-JSON bodies (e.g. Prometheus text exposition). */
  readonly schema?: z.ZodTypeAny;
}

export interface RouteSpec {
  /** Unique across the application, e.g. "system.health". */
  readonly id: string;
  readonly module: string;
  readonly method: HttpMethod;
  /** Full versioned path, e.g. "/api/v1/system/health" (Constitution rule 5). */
  readonly path: string;
  readonly summary: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly auth: RouteAuth;
  readonly request?: {
    /** Path parameters, e.g. { userId: z.string() } for /users/{userId}. */
    readonly params?: z.ZodTypeAny;
    readonly query?: z.ZodTypeAny;
    readonly body?: z.ZodTypeAny;
  };
  /** Mandatory for state-changing methods; defineRoute refuses to build without it. */
  readonly audit?: {
    readonly action: string;
    readonly resourceType: string;
  };
  readonly responses: Readonly<Record<number, RouteResponseSpec>>;
}

export interface JobSpec {
  /** Job name within the module's queue, e.g. "audit-heartbeat". */
  readonly name: string;
  /** Owning module; also the BullMQ queue name. */
  readonly module: string;
  readonly summary: string;
  readonly payloadSchema: z.ZodTypeAny;
}

export interface ModuleDefinition {
  /** Module identifier, e.g. "system". Also the queue name. */
  readonly name: string;
  /** Table-ownership prefix, e.g. "sys_" (Constitution rule 2). */
  readonly tablePrefix: string;
  /** Migrations directory, relative to the module's package root. */
  readonly migrationsDir: string;
  readonly routes: readonly RouteSpec[];
  readonly jobs: readonly JobSpec[];
}

/** A readiness contribution: throws (or rejects) when the dependency is unhealthy. */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Runtime side of the contract
// ---------------------------------------------------------------------------

export interface RouteRequest {
  /** Validated against RouteSpec.request.params before the handler runs. */
  readonly params: unknown;
  /** Validated against RouteSpec.request.query before the handler runs. */
  readonly query: unknown;
  /** Validated against RouteSpec.request.body before the handler runs. */
  readonly body: unknown;
  readonly headers: Headers;
}

export interface RouteContext {
  readonly requestId: string;
  readonly logger: Logger;
  /** Null only on public routes. */
  readonly principal: Principal | null;
  readonly request: RouteRequest;
}

export interface RouteResult {
  readonly status: number;
  /** JSON-serialized unless contentType is set (then body must be a string). */
  readonly body?: unknown;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Extra audit fields the handler can contribute for state-changing routes. */
  readonly audit?: {
    readonly resourceId?: string;
    readonly details?: Readonly<Record<string, unknown>>;
    /**
     * Actor override for routes where the acting identity is established BY
     * the handler rather than by the authenticator — e.g. login (public
     * route, but the audit actor is the user who just authenticated).
     */
    readonly actor?: {
      readonly type: ActorType;
      readonly id: string | null;
    };
  };
}

export type RouteHandler = (context: RouteContext) => Promise<RouteResult>;

export interface JobContext {
  readonly logger: Logger;
  readonly jobId: string;
  readonly attempt: number;
}

/** Payload has already been validated against JobSpec.payloadSchema. */
export type JobProcessor = (payload: unknown, context: JobContext) => Promise<void>;

export interface RuntimeModule<TService = unknown> {
  readonly definition: ModuleDefinition;
  /** Keyed by RouteSpec.id. Every RouteSpec must have a handler and vice versa. */
  readonly handlers: Readonly<Record<string, RouteHandler>>;
  /** Keyed by JobSpec.name. Every JobSpec must have a processor and vice versa. */
  readonly jobProcessors: Readonly<Record<string, JobProcessor>>;
  readonly readinessChecks: readonly ReadinessCheck[];
  /** The module's public service API — the ONLY thing other modules may call. */
  readonly service: TService;
}

/**
 * Structural self-check used by composition roots: verifies that a runtime
 * module's handlers/processors line up 1:1 with its definition.
 */
export function assertModuleWiring(module: RuntimeModule<unknown>): void {
  const routeIds = module.definition.routes.map((route) => route.id);
  const handlerIds = Object.keys(module.handlers);
  for (const id of routeIds) {
    if (!handlerIds.includes(id)) {
      throw new Error(`module "${module.definition.name}": route "${id}" has no handler`);
    }
  }
  for (const id of handlerIds) {
    if (!routeIds.includes(id)) {
      throw new Error(`module "${module.definition.name}": handler "${id}" has no route spec`);
    }
  }
  const jobNames = module.definition.jobs.map((job) => job.name);
  const processorNames = Object.keys(module.jobProcessors);
  for (const name of jobNames) {
    if (!processorNames.includes(name)) {
      throw new Error(`module "${module.definition.name}": job "${name}" has no processor`);
    }
  }
  for (const name of processorNames) {
    if (!jobNames.includes(name)) {
      throw new Error(`module "${module.definition.name}": processor "${name}" has no job spec`);
    }
  }
}
