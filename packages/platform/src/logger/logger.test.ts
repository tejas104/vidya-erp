import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

describe("createLogger", () => {
  it("honors the configured level and service bindings", () => {
    const logger = createLogger({
      level: "warn",
      serviceName: "vidya-test",
      serviceVersion: "9.9.9",
    });
    expect(logger.level).toBe("warn");
    expect(logger.bindings()).toMatchObject({ service: "vidya-test", version: "9.9.9" });
  });

  it("creates working child loggers for request correlation", () => {
    const logger = createLogger({ level: "silent", serviceName: "vidya-test" });
    const child = logger.child({ requestId: "req-1" });
    expect(child.bindings()).toMatchObject({ requestId: "req-1" });
  });
});
