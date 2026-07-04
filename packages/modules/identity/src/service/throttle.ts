/**
 * Fixed-window failure throttle backed by Redis (Fable-owned; ADR-0011).
 * Used for login attempts (keyed user+IP) and reset-token redemption
 * (keyed IP). Windows are enforced with Redis TTLs, so the state is shared
 * across replicas (Constitution rule 10).
 */

/** The Redis subset the throttle needs — ioredis satisfies it structurally. */
export interface ThrottleStore {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

export interface ThrottlePolicy {
  readonly maxAttempts: number;
  readonly windowMinutes: number;
}

export class FailureThrottle {
  constructor(
    private readonly store: ThrottleStore,
    private readonly policy: ThrottlePolicy,
    private readonly namespace: string,
  ) {}

  private key(subject: string): string {
    return `idn:throttle:${this.namespace}:${subject}`;
  }

  /**
   * Records one failure and reports whether the subject is now locked.
   * The window starts at the first failure and is NOT extended by later
   * failures (fixed window).
   */
  async recordFailure(subject: string): Promise<{ locked: boolean; failures: number }> {
    const failures = await this.store.incr(this.key(subject));
    if (failures === 1) {
      await this.store.expire(this.key(subject), this.policy.windowMinutes * 60);
    }
    return { locked: failures >= this.policy.maxAttempts, failures };
  }

  /** True when the subject has exhausted this window's attempts. */
  async isLocked(subject: string): Promise<boolean> {
    const value = await this.store.get(this.key(subject));
    return value !== null && Number(value) >= this.policy.maxAttempts;
  }

  /** Called on success so a legitimate login clears the failure history. */
  async clear(subject: string): Promise<void> {
    await this.store.del(this.key(subject));
  }
}
