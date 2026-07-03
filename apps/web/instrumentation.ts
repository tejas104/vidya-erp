/**
 * Next.js instrumentation hook — runs once per server start (never during
 * build). Eagerly constructs the web runtime so config validation, pool
 * creation and signal-handler registration happen at boot, not on the first
 * request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWebRuntime } = await import("./src/composition");
    getWebRuntime();
  }
}
