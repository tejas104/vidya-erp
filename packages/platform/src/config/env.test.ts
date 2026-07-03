import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env";

const validEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgres://vidya:pw@localhost:5432/vidya",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret-value-not-to-leak",
  S3_BUCKET: "vidya",
};

describe("loadConfig", () => {
  it("parses a minimal valid environment and applies defaults", () => {
    const config = loadConfig(validEnv);
    expect(config.env).toBe("development");
    expect(config.logLevel).toBe("info");
    expect(config.database.poolMax).toBe(10);
    expect(config.s3.forcePathStyle).toBe(true);
    expect(config.worker.metricsPort).toBe(9464);
    expect(config.lifecycle.drainMs).toBe(5000);
  });

  it("maps explicit values through to the typed config", () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      DATABASE_POOL_MAX: "25",
      S3_FORCE_PATH_STYLE: "false",
      SHUTDOWN_DRAIN_MS: "0",
    });
    expect(config.env).toBe("production");
    expect(config.logLevel).toBe("warn");
    expect(config.database.poolMax).toBe(25);
    expect(config.s3.forcePathStyle).toBe(false);
    expect(config.lifecycle.drainMs).toBe(0);
  });

  it("rejects a missing required variable, naming it", () => {
    const { DATABASE_URL: _omitted, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrowError(ConfigError);
    try {
      loadConfig(rest);
    } catch (error) {
      expect((error as ConfigError).issues.join("\n")).toContain("DATABASE_URL");
    }
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: "mysql://x/y" })).toThrowError(
      ConfigError,
    );
  });

  it("rejects a non-redis REDIS_URL", () => {
    expect(() => loadConfig({ ...validEnv, REDIS_URL: "http://localhost:6379" })).toThrowError(
      ConfigError,
    );
  });

  it("rejects out-of-range numerics", () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_POOL_MAX: "0" })).toThrowError(ConfigError);
    expect(() => loadConfig({ ...validEnv, WORKER_METRICS_PORT: "70000" })).toThrowError(
      ConfigError,
    );
  });

  it("never includes the offending value in error output", () => {
    try {
      loadConfig({ ...validEnv, REDIS_URL: "leaky-secret://oops" });
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("leaky-secret");
    }
  });
});
