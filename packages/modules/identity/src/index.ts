/**
 * @vidya/module-identity — PUBLIC API (the only importable surface).
 *
 * Identity & access: users, roles, scope grants, sessions, password
 * lifecycle. The security core (password hashing, session management,
 * scope-check) is HUMAN-OWNED under src/core and reached exclusively
 * through its contracts; this factory refuses to assemble without it
 * (fail-closed, ADR-0012).
 */

import { Counter } from "prom-client";
import {
  assertModuleWiring,
  type AuditLogger,
  type Authenticator,
  type Db,
  type Metrics,
  type RedisClient,
  type Role,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import { identityModuleDefinition, RESET_CLEANUP_JOB_NAME } from "./definition";
import { createIdentityHandlers } from "./api/handlers";
import { createUsersRepo } from "./repo/users-repo";
import { createResetTokensRepo } from "./repo/reset-tokens-repo";
import { UsersService } from "./service/users-service";
import { AuthService } from "./service/auth-service";
import { SessionAuthenticator } from "./service/authenticator";
import { FailureThrottle } from "./service/throttle";
import { createResetCleanupProcessor } from "./jobs/reset-token-cleanup";
import type { IdentityCore } from "./core/contracts";
import type { ExternalIdentityProvider } from "./providers/external";

export {
  RESET_CLEANUP_JOB_NAME,
  RESET_CLEANUP_SCHEDULER_ID,
  grantInputSchema,
  identityModuleDefinition,
  MODULE_NAME as IDENTITY_MODULE_NAME,
} from "./definition";
export {
  createIdentityCore,
  IdentityCoreNotProvidedError,
  type IdentityCore,
  type IdentityCoreOptions,
  type IssuedSession,
  type PasswordHasher,
  type SessionData,
  type SessionManager,
  type SessionRecord,
} from "./core/index";
export type { ExternalIdentityProvider } from "./providers/external";
export type { UserView } from "./service/users-service";

export interface IdentitySessionConfig {
  readonly cookieName: string;
  readonly cookieSecure: boolean;
  readonly ttlHours: number;
  readonly idleMinutes: number;
}

export interface IdentityModuleConfig {
  readonly session: IdentitySessionConfig;
  readonly resetTokenTtlMinutes: number;
  readonly throttle: {
    readonly maxAttempts: number;
    readonly windowMinutes: number;
  };
}

export interface IdentityModuleDeps {
  readonly db: Db;
  readonly redis: RedisClient;
  readonly metrics: Metrics;
  /** The audit seam (system module's implementation, injected by composition). */
  readonly audit: AuditLogger;
  /** HUMAN-OWNED security core; the module cannot exist without it. */
  readonly core: IdentityCore;
  readonly config: IdentityModuleConfig;
  /** LDAP/AD/SSO seam — no provider exists in #2 (contract only). */
  readonly externalProvider?: ExternalIdentityProvider;
}

/** What composition roots and other modules may use. */
export interface IdentityService {
  /** Replaces DenyAllAuthenticator in the pipeline. */
  readonly authenticator: Authenticator;
  /** The scope-check chokepoint every module's record access goes through. */
  readonly scopeChecker: ScopeChecker;
  /** One-time operator bootstrap (scripts/create-admin.ts). */
  bootstrapAdmin(input: {
    username: string;
    displayName: string;
    password: string;
    collegeId: string;
  }): Promise<{ userId: string }>;
}

export function createIdentityModule(deps: IdentityModuleDeps): RuntimeModule<IdentityService> {
  const usersRepo = createUsersRepo(deps.db);
  const resetTokensRepo = createResetTokensRepo(deps.db);

  const users = new UsersService({
    repo: usersRepo,
    hasher: deps.core.passwordHasher,
    sessions: deps.core.sessionManager,
    audit: deps.audit,
  });
  const auth = new AuthService({
    repo: usersRepo,
    resetTokens: resetTokensRepo,
    hasher: deps.core.passwordHasher,
    sessions: deps.core.sessionManager,
    audit: deps.audit,
    loginThrottle: new FailureThrottle(deps.redis, deps.config.throttle, "login"),
    resetThrottle: new FailureThrottle(deps.redis, deps.config.throttle, "reset"),
    resetTokenTtlMinutes: deps.config.resetTokenTtlMinutes,
    ...(deps.externalProvider !== undefined ? { externalProvider: deps.externalProvider } : {}),
  });

  const cookiePolicy = {
    name: deps.config.session.cookieName,
    secure: deps.config.session.cookieSecure,
  };

  const loginsTotal = new Counter({
    name: "vidya_logins_total",
    help: "Login attempts by outcome",
    labelNames: ["outcome"],
    registers: [deps.metrics.registry],
  });

  const module: RuntimeModule<IdentityService> = {
    definition: identityModuleDefinition,
    handlers: createIdentityHandlers({
      users,
      auth,
      scopeChecker: deps.core.scopeChecker,
      cookiePolicy,
      loginsTotal,
      throttleWindowMinutes: deps.config.throttle.windowMinutes,
    }),
    jobProcessors: {
      [RESET_CLEANUP_JOB_NAME]: createResetCleanupProcessor(resetTokensRepo, deps.audit),
    },
    readinessChecks: [],
    service: {
      authenticator: new SessionAuthenticator(deps.core.sessionManager, cookiePolicy),
      scopeChecker: deps.core.scopeChecker,
      bootstrapAdmin: (input) => users.bootstrapAdmin(input),
    },
  };
  assertModuleWiring(module);
  return module;
}

export type { Role };
