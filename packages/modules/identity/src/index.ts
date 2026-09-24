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
  type Logger,
  type Metrics,
  type OrgDirectory,
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
import { CredentialService } from "./service/credential-service";
import { DerivedGrantsService, type DerivedGrantsApi } from "./service/derived-grants";
import { GrantVerificationService } from "./service/grant-verification";
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
export { UsernameTakenError } from "./repo/users-repo";
export { passwordSchema, usernameSchema } from "./definition";
export type {
  DerivableRole,
  DerivedGrantInput,
  DerivedGrantView,
  DerivedGrantsApi,
} from "./service/derived-grants";

export interface IdentitySessionConfig {
  readonly cookieName: string;
  readonly cookieSecure: boolean;
  readonly ttlHours: number;
  readonly idleMinutes: number;
}

export interface IdentityModuleConfig {
  readonly session: IdentitySessionConfig;
  readonly resetTokenTtlMinutes: number;
  /** Reset-token redemption throttle (IP-keyed). */
  readonly throttle: {
    readonly maxAttempts: number;
    readonly windowMinutes: number;
  };
  /** Account lockout (#10.5 Part 2): consecutive login failures, keyed by account alone. */
  readonly lockout: {
    readonly maxAttempts: number;
    readonly windowMinutes: number;
  };
}

export interface IdentityModuleDeps {
  readonly db: Db;
  readonly redis: RedisClient;
  readonly metrics: Metrics;
  readonly logger: Logger;
  /** The audit seam (system module's implementation, injected by composition). */
  readonly audit: AuditLogger;
  /** HUMAN-OWNED security core; the module cannot exist without it. */
  readonly core: IdentityCore;
  readonly config: IdentityModuleConfig;
  /** LDAP/AD/SSO seam — no provider exists in #2 (contract only). */
  readonly externalProvider?: ExternalIdentityProvider;
  /**
   * Late-bound OrgDirectory (people module implements it; composition sets
   * the target after both modules exist). When wired, manual grants are
   * validated against the real org tree and the verification backfill
   * route becomes operational.
   */
  readonly orgDirectory?: () => OrgDirectory | null;
}

/** What composition roots and other modules may use. */
export interface IdentityService {
  /** Replaces DenyAllAuthenticator in the pipeline. */
  readonly authenticator: Authenticator;
  /** The scope-check chokepoint every module's record access goes through. */
  readonly scopeChecker: ScopeChecker;
  /**
   * Grant derivation surface for the people module (ADR-0015): teacher
   * assignments materialize as derived grants through this API and through
   * nothing else.
   */
  readonly derivedGrants: DerivedGrantsApi;
  /** One-time operator bootstrap (scripts/create-admin.ts). */
  bootstrapAdmin(input: {
    username: string;
    displayName: string;
    password: string;
    collegeId: string;
  }): Promise<{ userId: string }>;
  /**
   * Issues an ACTIVE login for a person who doesn't have one yet (#11 B2:
   * onboarding import, per-class/staff "issue login" actions). Returns the
   * plaintext temporary password exactly once — the caller must hand it off
   * (e.g. the credential sheet, #11 B4) and never persist it. `userId` is the
   * created account's identity id, for the caller to link back onto its own
   * record (e.g. people's student/teacher `identityUserId`).
   */
  issueCredential(input: {
    personName: string;
    username: string;
    collegeId: string;
    roles: readonly Role[];
    createdBy: string;
  }): Promise<{ userId: string; username: string; temporaryPassword: string }>;
  /** Narrow read for cross-module staff-account linking. Never returns secrets. */
  accountForLink(userId: string): Promise<{ collegeId: string; accountKind: "staff" | "guardian"; roles: readonly Role[] } | null>;
  /**
   * ADR-0027: creates a guardian's own login when they redeem an invitation.
   * No roles, ever; kind "guardian". Throws UsernameTakenError on a clash.
   */
  createGuardianAccount(input: {
    username: string;
    displayName: string;
    collegeId: string;
    password: string;
  }): Promise<{ userId: string; username: string }>;
}

export function createIdentityModule(deps: IdentityModuleDeps): RuntimeModule<IdentityService> {
  const usersRepo = createUsersRepo(deps.db);
  const resetTokensRepo = createResetTokensRepo(deps.db);
  const orgDirectory = deps.orgDirectory ?? (() => null);

  const users = new UsersService({
    repo: usersRepo,
    hasher: deps.core.passwordHasher,
    sessions: deps.core.sessionManager,
    audit: deps.audit,
    orgDirectory,
  });
  const derivedGrants = new DerivedGrantsService(
    usersRepo,
    deps.core.sessionManager,
    deps.audit,
  );
  const grantVerification = new GrantVerificationService(usersRepo, orgDirectory);
  const auth = new AuthService({
    repo: usersRepo,
    resetTokens: resetTokensRepo,
    hasher: deps.core.passwordHasher,
    sessions: deps.core.sessionManager,
    audit: deps.audit,
    logger: deps.logger,
    loginThrottle: new FailureThrottle(deps.redis, deps.config.lockout, "login"),
    resetThrottle: new FailureThrottle(deps.redis, deps.config.throttle, "reset"),
    resetTokenTtlMinutes: deps.config.resetTokenTtlMinutes,
    ...(deps.externalProvider !== undefined ? { externalProvider: deps.externalProvider } : {}),
  });
  const credentials = new CredentialService({ users });

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
      grantVerification,
      scopeChecker: deps.core.scopeChecker,
      cookiePolicy,
      loginsTotal,
      resetThrottleWindowMinutes: deps.config.throttle.windowMinutes,
      loginLockoutWindowMinutes: deps.config.lockout.windowMinutes,
    }),
    jobProcessors: {
      [RESET_CLEANUP_JOB_NAME]: createResetCleanupProcessor(resetTokensRepo, deps.audit),
    },
    readinessChecks: [],
    service: {
      authenticator: new SessionAuthenticator(
        deps.core.sessionManager,
        cookiePolicy,
        async (userId) => (await usersRepo.findById(userId))?.accountKind ?? null,
      ),
      scopeChecker: deps.core.scopeChecker,
      derivedGrants,
      bootstrapAdmin: (input) => users.bootstrapAdmin(input),
      issueCredential: (input) => credentials.issueCredential(input),
      accountForLink: async (userId) => {
        const account = await users.getUser(userId);
        return account ? { collegeId: account.collegeId, accountKind: account.accountKind, roles: account.roles } : null;
      },
      createGuardianAccount: (input) => credentials.createGuardianAccount(input),
    },
  };
  assertModuleWiring(module);
  return module;
}

export type { Role };
