import { describe, expect, it } from "vitest";
import { FailureThrottle } from "./throttle";
import { MemoryThrottleStore } from "../../test-support/fakes";

function makeThrottle(maxAttempts = 3) {
  const store = new MemoryThrottleStore();
  return { store, throttle: new FailureThrottle(store, { maxAttempts, windowMinutes: 15 }, "login") };
}

describe("FailureThrottle", () => {
  it("is unlocked for a clean subject", async () => {
    const { throttle } = makeThrottle();
    expect(await throttle.isLocked("asha|1.1.1.1")).toBe(false);
  });

  it("locks at the configured attempt count", async () => {
    const { throttle } = makeThrottle(3);
    expect((await throttle.recordFailure("s")).locked).toBe(false);
    expect((await throttle.recordFailure("s")).locked).toBe(false);
    expect((await throttle.recordFailure("s")).locked).toBe(true);
    expect(await throttle.isLocked("s")).toBe(true);
  });

  it("sets the window TTL on the first failure only", async () => {
    const { throttle, store } = makeThrottle();
    await throttle.recordFailure("s");
    await throttle.recordFailure("s");
    expect(store.expirations.get("idn:throttle:login:s")).toBe(15 * 60);
    expect([...store.expirations.keys()]).toHaveLength(1);
  });

  it("keeps subjects independent and clears on demand", async () => {
    const { throttle } = makeThrottle(2);
    await throttle.recordFailure("a");
    await throttle.recordFailure("a");
    expect(await throttle.isLocked("a")).toBe(true);
    expect(await throttle.isLocked("b")).toBe(false);
    await throttle.clear("a");
    expect(await throttle.isLocked("a")).toBe(false);
  });
});
