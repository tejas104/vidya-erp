import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export interface Metrics {
  readonly registry: Registry;
  readonly httpRequestDurationSeconds: Histogram<"module" | "route" | "method" | "status">;
  readonly httpRequestsTotal: Counter<"module" | "route" | "method" | "status">;
  readonly jobsTotal: Counter<"module" | "job" | "outcome">;
  readonly jobDurationSeconds: Histogram<"module" | "job" | "outcome">;
}

export interface MetricsOptions {
  readonly serviceName: string;
  /** Node process metrics (event loop lag, heap, GC). Default true. */
  readonly defaultMetrics?: boolean;
}

/**
 * Per-process Prometheus registry. Each replica exposes its own /metrics;
 * aggregation across replicas happens at scrape time, so no cross-replica
 * state exists here (Constitution rule 10).
 */
export function createMetrics(options: MetricsOptions): Metrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: options.serviceName });
  if (options.defaultMetrics !== false) {
    collectDefaultMetrics({ register: registry });
  }
  return {
    registry,
    httpRequestDurationSeconds: new Histogram({
      name: "vidya_http_request_duration_seconds",
      help: "HTTP request latency by route",
      labelNames: ["module", "route", "method", "status"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    httpRequestsTotal: new Counter({
      name: "vidya_http_requests_total",
      help: "HTTP requests by route and status",
      labelNames: ["module", "route", "method", "status"],
      registers: [registry],
    }),
    jobsTotal: new Counter({
      name: "vidya_jobs_total",
      help: "Background jobs processed by outcome",
      labelNames: ["module", "job", "outcome"],
      registers: [registry],
    }),
    jobDurationSeconds: new Histogram({
      name: "vidya_job_duration_seconds",
      help: "Background job processing time",
      labelNames: ["module", "job", "outcome"],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60],
      registers: [registry],
    }),
  };
}
