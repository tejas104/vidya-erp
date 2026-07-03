import type { Logger } from "../logger/logger";

export interface ShutdownHook {
  readonly name: string;
  run(): Promise<void>;
}

export interface LifecycleOptions {
  readonly logger: Logger;
  /**
   * Grace period between "start draining" (readiness flips to 503 so load
   * balancers stop routing here) and running the close hooks.
   */
  readonly drainMs: number;
  /** Hard ceiling for the whole hook sequence. */
  readonly timeoutMs: number;
}

export interface ShutdownSummary {
  readonly ok: boolean;
  readonly hookErrors: readonly { name: string; error: unknown }[];
  readonly timedOut: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Graceful-shutdown coordinator (Constitution rule 11).
 *
 * Web replicas cannot close Next.js's listener directly, so draining works
 * through readiness: `isDraining` flips immediately on SIGTERM, /ready
 * starts returning 503, the load balancer stops sending traffic, and after
 * `drainMs` the close hooks run (LIFO — reverse of registration, so
 * consumers close before the connections they depend on).
 */
export class Lifecycle {
  private readonly hooks: ShutdownHook[] = [];
  private draining = false;
  private shutdownPromise: Promise<ShutdownSummary> | null = null;

  constructor(private readonly options: LifecycleOptions) {}

  get isDraining(): boolean {
    return this.draining;
  }

  onShutdown(name: string, run: () => Promise<void>): void {
    this.hooks.push({ name, run });
  }

  shutdown(reason: string): Promise<ShutdownSummary> {
    if (this.shutdownPromise === null) {
      this.shutdownPromise = this.execute(reason);
    }
    return this.shutdownPromise;
  }

  private async execute(reason: string): Promise<ShutdownSummary> {
    const log = this.options.logger.child({ component: "lifecycle" });
    this.draining = true;
    log.info({ reason, drainMs: this.options.drainMs }, "shutdown initiated; draining");
    if (this.options.drainMs > 0) {
      await sleep(this.options.drainMs);
    }

    const hookErrors: { name: string; error: unknown }[] = [];
    let timedOut = false;

    const runHooks = async (): Promise<void> => {
      for (const hook of [...this.hooks].reverse()) {
        try {
          log.debug({ hook: hook.name }, "running shutdown hook");
          await hook.run();
        } catch (error) {
          log.error({ err: error, hook: hook.name }, "shutdown hook failed");
          hookErrors.push({ name: hook.name, error });
        }
      }
    };

    await Promise.race([
      runHooks(),
      sleep(this.options.timeoutMs).then(() => {
        timedOut = true;
      }),
    ]);

    if (timedOut) {
      log.error({ timeoutMs: this.options.timeoutMs }, "shutdown timed out before hooks finished");
    } else {
      log.info({ failedHooks: hookErrors.length }, "shutdown complete");
    }
    return { ok: hookErrors.length === 0 && !timedOut, hookErrors, timedOut };
  }

  /**
   * Wires SIGTERM/SIGINT to shutdown. `exit` is injectable for tests;
   * the default terminates the process with 0 on clean shutdown, 1 otherwise.
   */
  attachSignalHandlers(exit: (code: number) => void = (code) => process.exit(code)): void {
    const handle = (signal: string) => {
      void this.shutdown(`received ${signal}`).then((summary) => {
        exit(summary.ok ? 0 : 1);
      });
    };
    process.once("SIGTERM", () => handle("SIGTERM"));
    process.once("SIGINT", () => handle("SIGINT"));
  }
}
