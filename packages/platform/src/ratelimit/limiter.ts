import type { RateLimitScope } from "../contracts/module";

/**
 * Redis-backed request-rate limiting (Constitution rule 10: state shared
 * across replicas via TTL'd keys, never process memory). This is the ONE
 * platform middleware defineRoute calls — no module hand-rolls its own
 * limiting.
 *
 * Deliberately independent of identity's FailureThrottle
 * (packages/modules/identity/src/service/throttle.ts): that one counts
 * CREDENTIAL FAILURES to drive account lockout (a security/credential
 * concern); this one counts EVERY request to bound request volume (an
 * availability/abuse concern). Same shape, different axis — conflating them
 * would let a flood of successful requests dodge the ceiling.
 */

/** The Redis subset a limiter needs — ioredis satisfies it structurally. */
export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

export interface RateLimitDecision {
  readonly limited: boolean;
  /** Seconds until the caller may retry. 0 when not limited. */
  readonly retryAfterSeconds: number;
}

export interface FixedWindowPolicy {
  readonly max: number;
  readonly windowSeconds: number;
}

/**
 * Counts hits in a fixed window (the window starts at the first hit and is
 * NOT extended by later ones — same fixed-window shape as FailureThrottle).
 * Every key carries a TTL equal to the window, so an idle subject leaves no
 * trace once the window lapses.
 */
export class FixedWindowLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly policy: FixedWindowPolicy,
    private readonly namespace: string,
  ) {}

  private key(subject: string): string {
    return `ratelimit:${this.namespace}:${subject}`;
  }

  async hit(subject: string): Promise<RateLimitDecision> {
    const key = this.key(subject);
    const count = await this.store.incr(key);
    if (count === 1) {
      await this.store.expire(key, this.policy.windowSeconds);
    }
    if (count <= this.policy.max) {
      return { limited: false, retryAfterSeconds: 0 };
    }
    const ttl = await this.store.ttl(key);
    return { limited: true, retryAfterSeconds: ttl > 0 ? ttl : this.policy.windowSeconds };
  }
}

export interface BackoffPolicy {
  readonly max: number;
  readonly windowSeconds: number;
  readonly baseBackoffSeconds: number;
  readonly maxBackoffSeconds: number;
  /** How long an escalation streak is remembered before it resets to level 0. */
  readonly penaltyMemorySeconds: number;
}

/**
 * Fixed-window counting exactly like FixedWindowLimiter, but once the
 * window is exceeded it imposes a block whose duration DOUBLES each time
 * the subject re-offends while its penalty memory is warm (exponential
 * backoff), capped at maxBackoffSeconds. All three keys (count/penalty/
 * block) carry independent TTLs — none of them can leak forever.
 */
export class BackoffLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly policy: BackoffPolicy,
    private readonly namespace: string,
  ) {}

  private countKey(subject: string): string {
    return `ratelimit:${this.namespace}:${subject}:count`;
  }
  private blockKey(subject: string): string {
    return `ratelimit:${this.namespace}:${subject}:blocked`;
  }
  private penaltyKey(subject: string): string {
    return `ratelimit:${this.namespace}:${subject}:penalty`;
  }

  async hit(subject: string): Promise<RateLimitDecision> {
    const blockTtl = await this.store.ttl(this.blockKey(subject));
    if (blockTtl > 0) {
      return { limited: true, retryAfterSeconds: blockTtl };
    }

    const count = await this.store.incr(this.countKey(subject));
    if (count === 1) {
      await this.store.expire(this.countKey(subject), this.policy.windowSeconds);
    }
    if (count <= this.policy.max) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    const penalty = await this.store.incr(this.penaltyKey(subject));
    if (penalty === 1) {
      await this.store.expire(this.penaltyKey(subject), this.policy.penaltyMemorySeconds);
    }
    const backoffSeconds = Math.min(
      this.policy.baseBackoffSeconds * 2 ** (penalty - 1),
      this.policy.maxBackoffSeconds,
    );
    await this.store.incr(this.blockKey(subject));
    await this.store.expire(this.blockKey(subject), backoffSeconds);
    return { limited: true, retryAfterSeconds: backoffSeconds };
  }
}

export interface RateLimiterConfig {
  /** Login, per source IP: generous, but backs off exponentially on abuse. */
  readonly loginIp: BackoffPolicy;
  /** Login, per username regardless of IP — stops distributed credential guessing. */
  readonly loginUsername: FixedWindowPolicy;
  /** Password set/change/reset family: stricter than login, IP + identifier. */
  readonly password: FixedWindowPolicy;
  /** Blanket ceiling on any one authenticated session. */
  readonly session: FixedWindowPolicy;
}

/**
 * THE rate-limiting seam defineRoute depends on. One instance, backed by one
 * Redis client, covers every scope — nothing module-specific lives here or
 * in defineRoute; RouteSpec.rateLimit only says WHICH scope and WHICH
 * identifier field applies to a given route.
 */
export interface RateLimiter {
  /** Per-IP check for a rate-limited route (always applied for that scope). */
  checkIp(scope: RateLimitScope, ip: string): Promise<RateLimitDecision>;
  /** Per-identifier check (username, target account id, or principal id). */
  checkIdentifier(scope: RateLimitScope, identifier: string): Promise<RateLimitDecision>;
  /** Global per-session request ceiling — independent of route scope. */
  checkSession(sessionId: string): Promise<RateLimitDecision>;
}

export function createRateLimiter(store: RateLimitStore, config: RateLimiterConfig): RateLimiter {
  const loginIp = new BackoffLimiter(store, config.loginIp, "login-ip");
  const loginUsername = new FixedWindowLimiter(store, config.loginUsername, "login-user");
  const passwordIp = new FixedWindowLimiter(store, config.password, "password-ip");
  const passwordIdentifier = new FixedWindowLimiter(store, config.password, "password-id");
  const session = new FixedWindowLimiter(store, config.session, "session");

  return {
    checkIp: (scope, ip) => (scope === "login" ? loginIp.hit(ip) : passwordIp.hit(ip)),
    checkIdentifier: (scope, identifier) =>
      scope === "login" ? loginUsername.hit(identifier) : passwordIdentifier.hit(identifier),
    checkSession: (sessionId) => session.hit(sessionId),
  };
}
