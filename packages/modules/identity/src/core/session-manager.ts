import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { RedisClient } from "@vidya/platform";
import type {
  IssuedSession,
  SessionData,
  SessionManager,
  SessionRecord,
} from "./contracts";

/**
 * Redis-backed SessionManager (split-token design).
 *
 * The cookie token is `<sessionId>.<secret>` where the secret is 256 bits
 * from randomBytes. Only sha256(secret) is stored server-side (contract:
 * the token is never stored in plaintext), so neither a Redis dump nor a
 * log line yields a usable token; presenting one requires the original
 * secret, verified with a constant-time comparison. Tampering with either
 * half resolves to null — the id half misses the key, the secret half
 * fails the hash check.
 *
 * Expiry uses both windows of the contract: the record carries the
 * absolute `expiresAt` (checked on every resolve), while the Redis key TTL
 * enforces the idle window — each successful resolve slides it by
 * `idleSeconds`, capped at the time remaining to the absolute limit, so a
 * session can never outlive its TTL under any amount of activity.
 *
 * Keys are deterministic (`idn:session:*`, `idn:user-sessions:*`) so every
 * replica sees every session — invalidation on password/role change is
 * global by construction (Constitution rule 10).
 */

export interface SessionManagerOptions {
  readonly redis: RedisClient;
  readonly session: {
    readonly ttlSeconds: number;
    readonly idleSeconds: number;
  };
}

interface StoredSession {
  readonly secretHash: string;
  readonly data: SessionData;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

const sessionKey = (sessionId: string): string => `idn:session:${sessionId}`;
const userSessionsKey = (userId: string): string => `idn:user-sessions:${userId}`;

const hashSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

function secretMatches(storedHash: string, presentedSecret: string): boolean {
  const expected = Buffer.from(storedHash, "hex");
  const actual = createHash("sha256").update(presentedSecret).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** `<uuid>.<base64url secret>` — anything else is garbage, not an error. */
function parseToken(token: string): { sessionId: string; secret: string } | null {
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  const separator = token.indexOf(".");
  if (separator === -1) {
    return null;
  }
  const sessionId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (sessionId.length !== 36 || secret.length === 0) {
    return null;
  }
  return { sessionId, secret };
}

class RedisSessionManager implements SessionManager {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number,
    private readonly idleSeconds: number,
  ) {}

  async issue(data: SessionData): Promise<IssuedSession> {
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + this.ttlSeconds * 1000);
    const stored: StoredSession = {
      secretHash: hashSecret(secret),
      data,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const firstWindowMs = Math.min(this.idleSeconds, this.ttlSeconds) * 1000;
    await this.redis
      .multi()
      .set(sessionKey(sessionId), JSON.stringify(stored), "PX", firstWindowMs)
      .sadd(userSessionsKey(data.userId), sessionId)
      // The index only needs to outlive its members; ttlSeconds is every
      // member's upper bound, refreshed on each issue. Stale ids are
      // tolerated — invalidateAllForUser counts actual deletions.
      .expire(userSessionsKey(data.userId), this.ttlSeconds)
      .exec();
    return { token: `${sessionId}.${secret}`, sessionId, expiresAt };
  }

  async resolve(token: string): Promise<SessionRecord | null> {
    const parsed = parseToken(token);
    if (parsed === null) {
      return null;
    }
    const raw = await this.redis.get(sessionKey(parsed.sessionId));
    if (raw === null) {
      return null;
    }
    let stored: StoredSession;
    try {
      stored = JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
    if (!secretMatches(stored.secretHash, parsed.secret)) {
      return null;
    }
    const expiresAt = new Date(stored.expiresAt);
    const remainingMs = expiresAt.getTime() - Date.now();
    if (remainingMs <= 0) {
      // The idle TTL normally reaps this first; reap eagerly if we won.
      await this.invalidate(parsed.sessionId);
      return null;
    }
    await this.redis.pexpire(
      sessionKey(parsed.sessionId),
      Math.min(this.idleSeconds * 1000, remainingMs),
    );
    return {
      ...stored.data,
      sessionId: parsed.sessionId,
      issuedAt: new Date(stored.issuedAt),
      expiresAt,
    };
  }

  async invalidate(sessionId: string): Promise<void> {
    const raw = await this.redis.get(sessionKey(sessionId));
    await this.redis.del(sessionKey(sessionId));
    if (raw === null) {
      return;
    }
    try {
      const stored = JSON.parse(raw) as StoredSession;
      await this.redis.srem(userSessionsKey(stored.data.userId), sessionId);
    } catch {
      // Unparseable record: the session key is gone, which is what matters.
    }
  }

  async invalidateAllForUser(userId: string): Promise<number> {
    const indexKey = userSessionsKey(userId);
    const sessionIds = await this.redis.smembers(indexKey);
    let invalidated = 0;
    if (sessionIds.length > 0) {
      // DEL reports how many keys actually existed, so expired or already
      // invalidated ids in the index do not inflate the count.
      invalidated = await this.redis.del(...sessionIds.map(sessionKey));
    }
    await this.redis.del(indexKey);
    return invalidated;
  }
}

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  return new RedisSessionManager(
    options.redis,
    options.session.ttlSeconds,
    options.session.idleSeconds,
  );
}
