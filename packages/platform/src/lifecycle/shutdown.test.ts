import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { Lifecycle } from "./shutdown";

const logger = pino({ level: "silent" });

function makeLifecycle(overrides: { drainMs?: number; timeoutMs?: number } = {}) {
  return new Lifecycle({
    logger,
    drainMs: overrides.drainMs ?? 0,
    timeoutMs: overrides.timeoutMs ?? 1000,
  });
}

describe("Lifecycle", () => {
  it("flips isDraining immediately so /ready can start failing", async () => {
    const lifecycle = makeLifecycle({ drainMs: 25 });
    expect(lifecycle.isDraining).toBe(false);
    const done = lifecycle.shutdown("test");
    expect(lifecycle.isDraining).toBe(true);
    await done;
  });

  it("runs hooks in LIFO order (consumers close before their connections)", async () => {
    const lifecycle = makeLifecycle();
    const order: string[] = [];
    lifecycle.onShutdown("postgres-pool", async () => {
      order.push("postgres-pool");
    });
    lifecycle.onShutdown("bullmq-worker", async () => {
      order.push("bullmq-worker");
    });
    const summary = await lifecycle.shutdown("test");
    expect(order).toEqual(["bullmq-worker", "postgres-pool"]);
    expect(summary.ok).toBe(true);
  });

  it("is idempotent — concurrent shutdowns share one execution", async () => {
    const lifecycle = makeLifecycle();
    let runs = 0;
    lifecycle.onShutdown("counter", async () => {
      runs += 1;
    });
    const [first, second] = await Promise.all([
      lifecycle.shutdown("first"),
      lifecycle.shutdown("second"),
    ]);
    expect(runs).toBe(1);
    expect(first).toBe(second);
  });

  it("collects hook failures without aborting the sequence", async () => {
    const lifecycle = makeLifecycle();
    const order: string[] = [];
    lifecycle.onShutdown("healthy", async () => {
      order.push("healthy");
    });
    lifecycle.onShutdown("broken", async () => {
      throw new Error("close failed");
    });
    const summary = await lifecycle.shutdown("test");
    expect(order).toEqual(["healthy"]);
    expect(summary.ok).toBe(false);
    expect(summary.hookErrors).toHaveLength(1);
    expect(summary.hookErrors[0]?.name).toBe("broken");
  });

  it("reports a timeout when hooks exceed the ceiling", async () => {
    const lifecycle = makeLifecycle({ timeoutMs: 1000 });
    lifecycle.onShutdown("stuck", () => new Promise(() => undefined));
    const summary = await lifecycle.shutdown("test");
    expect(summary.timedOut).toBe(true);
    expect(summary.ok).toBe(false);
  });

  it("exits through the injected exit function on SIGTERM", async () => {
    const lifecycle = makeLifecycle();
    let exitCode: number | null = null;
    let resolveExit: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    lifecycle.attachSignalHandlers((code) => {
      exitCode = code;
      resolveExit();
    });
    process.emit("SIGTERM");
    await exited;
    expect(exitCode).toBe(0);
  });
});
