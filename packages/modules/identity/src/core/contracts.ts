import type {
  Role,
  ScopeChecker,
  ScopeGrant,
  RedisClient,
} from "@vidya/platform";

/**
 * CONTRACTS FOR THE HUMAN-OWNED SECURITY CORE (Vidya #2 ownership split).
 *
 * Fable authors these interfaces, the conformance suites under
 * ./conformance, and all surrounding plumbing — and NEVER the
 * implementations. The implementations live in ./index.ts (and files it
 * imports), are listed in CODEOWNERS, and must pass the conformance suites
 * before acceptance. Acceptance additionally requires a human to have read
 * and understood the implementation code itself.
 */

// ---------------------------------------------------------------------------
// Password hashing / credential verification (HUMAN-OWNED implementation)
// ---------------------------------------------------------------------------

export interface PasswordHasher {
  /**
   * A syntactically valid hash of an unknowable value. The login flow
   * verifies against this when the username does not exist, so unknown-user
   * and wrong-password take comparable time (user-enumeration resistance).
   */
  readonly dummyHash: string;
  /** argon2id recommended; parameter choices are the implementer's. */
  hash(password: string): Promise<string>;
  /** Constant-time-comparison semantics required. Never throws on bad hash input; returns false. */
  verify(hash: string, password: string): Promise<boolean>;
  /** True when the stored hash predates current parameters (login rehashes). */
  needsRehash(hash: string): boolean;
}

// ---------------------------------------------------------------------------
// Session issuance / resolution / invalidation (HUMAN-OWNED implementation)
// ---------------------------------------------------------------------------

/** Snapshot captured at issue time; role/scope changes invalidate sessions. */
export interface SessionData {
  readonly userId: string;
  readonly displayName: string;
  readonly roles: readonly Role[];
  readonly grants: readonly ScopeGrant[];
}

export interface IssuedSession {
  /** Opaque signed token for the cookie. Never logged, never stored server-side in plaintext. */
  readonly token: string;
  /** Server-side session id — safe to log and audit. */
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export interface SessionRecord extends SessionData {
  readonly sessionId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface SessionManager {
  issue(data: SessionData): Promise<IssuedSession>;
  /**
   * Verifies token integrity and TTL/idle windows; slides the idle window.
   * Returns null for anything invalid — expired, tampered, unknown,
   * or belonging to an invalidated session. Must not throw on garbage input.
   */
  resolve(token: string): Promise<SessionRecord | null>;
  invalidate(sessionId: string): Promise<void>;
  /** Used on password change/reset and role/scope changes. Returns count invalidated. */
  invalidateAllForUser(userId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// The assembled core
// ---------------------------------------------------------------------------

export interface IdentityCore {
  readonly passwordHasher: PasswordHasher;
  readonly sessionManager: SessionManager;
  /** The scope-check chokepoint (interface in @vidya/platform; matrix in ADR-0010). */
  readonly scopeChecker: ScopeChecker;
}

export interface IdentityCoreOptions {
  readonly redis: RedisClient;
  readonly session: {
    readonly ttlHours: number;
    readonly idleMinutes: number;
  };
}
