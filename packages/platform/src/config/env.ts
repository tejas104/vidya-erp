import { z } from "zod";

const booleanish = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "must be a postgres:// or postgresql:// URL",
    }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("redis://") || value.startsWith("rediss://"), {
      message: "must be a redis:// or rediss:// URL",
    }),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanish.default("true"),

  WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
  SYSTEM_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(300000),

  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).default(5000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),

  SERVICE_VERSION: z.string().min(1).default("0.1.0"),
});

export interface AppConfig {
  readonly env: "development" | "test" | "production";
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  readonly serviceVersion: string;
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly redis: {
    readonly url: string;
  };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
  };
  readonly worker: {
    readonly metricsPort: number;
    readonly systemHeartbeatIntervalMs: number;
  };
  readonly lifecycle: {
    readonly drainMs: number;
    readonly timeoutMs: number;
  };
}

export class ConfigError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/**
 * Parses and validates process environment into the typed application config.
 * Failure messages contain variable names and constraint descriptions only —
 * never the offending values, which may be secrets.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new ConfigError(issues);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    serviceVersion: env.SERVICE_VERSION,
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
    redis: {
      url: env.REDIS_URL,
    },
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      bucket: env.S3_BUCKET,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
    worker: {
      metricsPort: env.WORKER_METRICS_PORT,
      systemHeartbeatIntervalMs: env.SYSTEM_HEARTBEAT_INTERVAL_MS,
    },
    lifecycle: {
      drainMs: env.SHUTDOWN_DRAIN_MS,
      timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    },
  };
}
