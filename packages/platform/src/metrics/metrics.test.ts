import { describe, expect, it } from "vitest";
import { createMetrics } from "./metrics";

describe("createMetrics", () => {
  it("exposes Vidya http and job metrics in Prometheus exposition format", async () => {
    const metrics = createMetrics({ serviceName: "test", defaultMetrics: false });
    metrics.httpRequestsTotal.inc({ module: "system", route: "system.health", method: "GET", status: "200" });
    metrics.jobsTotal.inc({ module: "system", job: "audit-heartbeat", outcome: "success" });
    const text = await metrics.registry.metrics();
    expect(text).toContain("vidya_http_requests_total");
    expect(text).toContain("vidya_jobs_total");
    expect(text).toContain('service="test"');
  });

  it("registers Node default metrics unless disabled", async () => {
    const metrics = createMetrics({ serviceName: "test" });
    const text = await metrics.registry.metrics();
    expect(text).toContain("process_cpu_user_seconds_total");
  });
});
