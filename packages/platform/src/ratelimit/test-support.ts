import type { RateLimitStore } from "./limiter";

/**
 * Faithful in-memory fake of the Redis subset RateLimitStore needs: real
 * TTL semantics (a key reaps itself once its expiry passes), not just a
 * call recorder. Shared by limiter.test.ts and define-route.test.ts so both
 * exercise the same TTL behaviour the real ioredis client would give.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly values = new Map<string, number>();
  private readonly expiresAt = new Map<string, number>();

  private reapIfExpired(key: string): void {
    const expiry = this.expiresAt.get(key);
    if (expiry !== undefined && Date.now() >= expiry) {
      this.values.delete(key);
      this.expiresAt.delete(key);
    }
  }

  async incr(key: string): Promise<number> {
    this.reapIfExpired(key);
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expiresAt.set(key, Date.now() + seconds * 1000);
  }

  /** ioredis convention: -2 unknown key, -1 no TTL set, else seconds remaining. */
  async ttl(key: string): Promise<number> {
    this.reapIfExpired(key);
    if (!this.values.has(key)) {
      return -2;
    }
    const expiry = this.expiresAt.get(key);
    if (expiry === undefined) {
      return -1;
    }
    return Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
  }

  /** Test helper only — not part of RateLimitStore. */
  hasKey(key: string): boolean {
    this.reapIfExpired(key);
    return this.values.has(key);
  }
}
