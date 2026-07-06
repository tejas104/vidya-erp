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

  /** Comma-separated allowed Origins for state-changing requests (CSRF layer 2). */
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
    )
    .refine(
      (origins) =>
        origins.every((origin) => {
          try {
            return new URL(origin).origin === origin;
          } catch {
            return false;
          }
        }),
      { message: "each entry must be a bare origin like https://vidya.example.edu" },
    ),
  BODY_MAX_BYTES: z.coerce.number().int().min(1024).default(1_048_576),

  SESSION_COOKIE_NAME: z.string().min(1).default("vidya_session"),
  SESSION_COOKIE_SECURE: booleanish.default("true"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(30),
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),

  /** Aggregates over fewer distinct students are withheld (ADR-0018). */
  ANALYTICS_MIN_COHORT: z.coerce.number().int().min(1).max(100).default(5),
  /** At-risk when attendance %% falls below this. */
  ANALYTICS_ATTENDANCE_THRESHOLD: z.coerce.number().min(1).max(100).default(75),
  /** At-risk when average marks (%% of max) fall below this. */
  ANALYTICS_MARKS_THRESHOLD: z.coerce.number().min(1).max(100).default(40),

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
  readonly http: {
    readonly trustedOrigins: readonly string[];
    readonly bodyMaxBytes: number;
  };
  readonly identity: {
    readonly session: {
      readonly cookieName: string;
      readonly cookieSecure: boolean;
      readonly ttlHours: number;
      readonly idleMinutes: number;
    };
    readonly resetTokenTtlMinutes: number;
    readonly throttle: {
      readonly maxAttempts: number;
      readonly windowMinutes: number;
    };
  };
  readonly analytics: {
    readonly minCohort: number;
    readonly attendanceThreshold: number;
    readonly marksThreshold: number;
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
    http: {
      trustedOrigins: env.TRUSTED_ORIGINS,
      bodyMaxBytes: env.BODY_MAX_BYTES,
    },
    identity: {
      session: {
        cookieName: env.SESSION_COOKIE_NAME,
        cookieSecure: env.SESSION_COOKIE_SECURE,
        ttlHours: env.SESSION_TTL_HOURS,
        idleMinutes: env.SESSION_IDLE_MINUTES,
      },
      resetTokenTtlMinutes: env.RESET_TOKEN_TTL_MINUTES,
      throttle: {
        maxAttempts: env.LOGIN_MAX_ATTEMPTS,
        windowMinutes: env.LOGIN_WINDOW_MINUTES,
      },
    },
    analytics: {
      minCohort: env.ANALYTICS_MIN_COHORT,
      attendanceThreshold: env.ANALYTICS_ATTENDANCE_THRESHOLD,
      marksThreshold: env.ANALYTICS_MARKS_THRESHOLD,
    },
  };
}
