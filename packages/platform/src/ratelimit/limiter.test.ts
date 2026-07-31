import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackoffLimiter, FixedWindowLimiter, createRateLimiter } from "./limiter";
import { MemoryRateLimitStore } from "./test-support";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("FixedWindowLimiter", () => {
  function make(max = 3, windowSeconds = 60) {
    const store = new MemoryRateLimitStore();
    return { store, limiter: new FixedWindowLimiter(store, { max, windowSeconds }, "test") };
  }

  it("allows hits up to the configured max", async () => {
    const { limiter } = make(3);
    expect((await limiter.hit("a")).limited).toBe(false);
    expect((await limiter.hit("a")).limited).toBe(false);
    expect((await limiter.hit("a")).limited).toBe(false);
  });

  it("blocks the hit that exceeds max, with a Retry-After matching the window", async () => {
    const { limiter } = make(3, 60);
    await limiter.hit("a");
    await limiter.hit("a");
    await limiter.hit("a");
    const fourth = await limiter.hit("a");
    expect(fourth.limited).toBe(true);
    expect(fourth.retryAfterSeconds).toBe(60);
  });

  it("keeps subjects independent", async () => {
    const { limiter } = make(1);
    expect((await limiter.hit("a")).limited).toBe(false);
    expect((await limiter.hit("a")).limited).toBe(true);
    expect((await limiter.hit("b")).limited).toBe(false);
  });

  it("sets the TTL on the first hit only (demonstrates the key is TTL'd, not permanent)", async () => {
    const { store, limiter } = make(5, 30);
    await limiter.hit("a");
    expect(await store.ttl("ratelimit:test:a")).toBe(30);
    await limiter.hit("a");
    // TTL untouched by the second hit (fixed window, not sliding).
    expect(await store.ttl("ratelimit:test:a")).toBe(30);
  });

  it("resets and allows again once the window expires", async () => {
    const { store, limiter } = make(1, 10);
    expect((await limiter.hit("a")).limited).toBe(false);
    expect((await limiter.hit("a")).limited).toBe(true);
    vi.advanceTimersByTime(10_001);
    expect(await store.ttl("ratelimit:test:a")).toBe(-2);
    expect((await limiter.hit("a")).limited).toBe(false);
  });
});

describe("BackoffLimiter", () => {
  function make() {
    const store = new MemoryRateLimitStore();
    const limiter = new BackoffLimiter(
      store,
      {
        max: 2,
        windowSeconds: 60,
        baseBackoffSeconds: 60,
        maxBackoffSeconds: 480,
        penaltyMemorySeconds: 3600,
      },
      "test-ip",
    );
    return { store, limiter };
  }

  it("allows up to max, then blocks with the base backoff", async () => {
    const { limiter } = make();
    expect((await limiter.hit("1.1.1.1")).limited).toBe(false);
    expect((await limiter.hit("1.1.1.1")).limited).toBe(false);
    const third = await limiter.hit("1.1.1.1");
    expect(third.limited).toBe(true);
    expect(third.retryAfterSeconds).toBe(60);
  });

  it("keeps returning limited (without re-escalating) while still inside the current block", async () => {
    const { limiter } = make();
    await limiter.hit("1.1.1.1");
    await limiter.hit("1.1.1.1");
    const first = await limiter.hit("1.1.1.1");
    vi.advanceTimersByTime(5_000);
    const again = await limiter.hit("1.1.1.1");
    expect(again.limited).toBe(true);
    expect(again.retryAfterSeconds).toBeLessThanOrEqual(first.retryAfterSeconds);
    expect(again.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("escalates the backoff exponentially on repeat offense after the block lapses", async () => {
    const { limiter } = make();
    await limiter.hit("1.1.1.1");
    await limiter.hit("1.1.1.1");
    const firstBlock = await limiter.hit("1.1.1.1"); // 60s
    expect(firstBlock.retryAfterSeconds).toBe(60);

    vi.advanceTimersByTime(60_001); // block lapses, count window also lapses
    await limiter.hit("1.1.1.1");
    await limiter.hit("1.1.1.1");
    const secondBlock = await limiter.hit("1.1.1.1"); // penalty streak still warm -> 120s
    expect(secondBlock.retryAfterSeconds).toBe(120);

    vi.advanceTimersByTime(120_001);
    await limiter.hit("1.1.1.1");
    await limiter.hit("1.1.1.1");
    const thirdBlock = await limiter.hit("1.1.1.1"); // -> 240s
    expect(thirdBlock.retryAfterSeconds).toBe(240);
  });

  it("caps escalation at maxBackoffSeconds", async () => {
    const { limiter } = make();
    let lastRetry = 0;
    for (let round = 0; round < 6; round += 1) {
      await limiter.hit("1.1.1.1");
      await limiter.hit("1.1.1.1");
      const blocked = await limiter.hit("1.1.1.1");
      lastRetry = blocked.retryAfterSeconds;
      vi.advanceTimersByTime((lastRetry + 1) * 1000);
    }
    expect(lastRetry).toBe(480);
  });

  it("forgets the penalty streak once penaltyMemorySeconds passes quietly", async () => {
    const { limiter } = make();
    await limiter.hit("1.1.1.1");
    await limiter.hit("1.1.1.1");
    await limiter.hit("1.1.1.1"); // 60s block, penalty level 1

    vi.advanceTimersByTime(3_600_001); // block AND penalty memory both lapse
    await limiter.hit("1.1.1.1");
    await limiter.hit("1.1.1.1");
    const blocked = await limiter.hit("1.1.1.1");
    expect(blocked.retryAfterSeconds).toBe(60); // back to base, not escalated
  });

  it("TTLs every key it writes (count, penalty, block) — none leak forever", async () => {
    const { store } = make();
    const limiter = new BackoffLimiter(
      store,
      { max: 1, windowSeconds: 60, baseBackoffSeconds: 30, maxBackoffSeconds: 120, penaltyMemorySeconds: 900 },
      "ttl-demo",
    );
    await limiter.hit("2.2.2.2");
    await limiter.hit("2.2.2.2"); // trips the block
    expect(await store.ttl("ratelimit:ttl-demo:2.2.2.2:count")).toBe(60);
    expect(await store.ttl("ratelimit:ttl-demo:2.2.2.2:penalty")).toBe(900);
    expect(await store.ttl("ratelimit:ttl-demo:2.2.2.2:blocked")).toBe(30);
  });
});

describe("createRateLimiter (facade + scope independence)", () => {
  function make() {
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter(store, {
      loginIp: { max: 10, windowSeconds: 60, baseBackoffSeconds: 60, maxBackoffSeconds: 1800, penaltyMemorySeconds: 3600 },
      loginUsername: { max: 5, windowSeconds: 60 },
      password: { max: 3, windowSeconds: 60 },
      session: { max: 100, windowSeconds: 60 },
    });
    return { store, limiter };
  }

  it("routes login IP checks through the backoff limiter", async () => {
    const { limiter } = make();
    for (let i = 0; i < 10; i += 1) {
      expect((await limiter.checkIp("login", "9.9.9.9")).limited).toBe(false);
    }
    expect((await limiter.checkIp("login", "9.9.9.9")).limited).toBe(true);
  });

  it("routes password IP checks through a plain fixed window (no backoff escalation)", async () => {
    const { limiter } = make();
    await limiter.checkIp("password", "9.9.9.9");
    await limiter.checkIp("password", "9.9.9.9");
    await limiter.checkIp("password", "9.9.9.9");
    const fourth = await limiter.checkIp("password", "9.9.9.9");
    expect(fourth.limited).toBe(true);
    expect(fourth.retryAfterSeconds).toBe(60);
  });

  it("per-IP and per-username counters for login are independent — one tripping doesn't mask the other", async () => {
    const { limiter } = make();
    // A distributed attack: five different IPs each try the SAME username
    // once. No single IP trips its own 10/min ceiling, but the per-username
    // ceiling (5/min) must trip regardless.
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5"]) {
      const ipCheck = await limiter.checkIp("login", ip);
      expect(ipCheck.limited).toBe(false);
    }
    // Policy allows 5/min for a username; the 6th trips it.
    let identifierCheck = { limited: false, retryAfterSeconds: 0 };
    for (let i = 0; i < 6; i += 1) {
      identifierCheck = await limiter.checkIdentifier("login", "asha");
    }
    expect(identifierCheck.limited).toBe(true);

    // Conversely, a single IP hammering many DIFFERENT usernames trips its
    // own IP ceiling while no individual username is anywhere near its cap.
    for (let i = 0; i < 10; i += 1) {
      await limiter.checkIp("login", "6.6.6.6");
    }
    expect((await limiter.checkIp("login", "6.6.6.6")).limited).toBe(true);
    expect((await limiter.checkIdentifier("login", "different-user")).limited).toBe(false);
  });

  it("session ceiling is scoped independently of login/password counters", async () => {
    const { limiter } = make();
    await limiter.checkIp("login", "shared-key");
    await limiter.checkIdentifier("login", "shared-key");
    const session = await limiter.checkSession("shared-key");
    expect(session.limited).toBe(false); // namespaced separately, no cross-talk
  });
});
