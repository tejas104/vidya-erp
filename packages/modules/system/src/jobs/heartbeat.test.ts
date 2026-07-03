import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { AuditEvent, AuditLogger, JobContext } from "@vidya/platform";
import { createHeartbeatProcessor } from "./heartbeat";

const jobContext: JobContext = {
  logger: pino({ level: "silent" }),
  jobId: "job-7",
  attempt: 2,
};

class RecordingAudit implements AuditLogger {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

describe("heartbeat processor", () => {
  it("writes a system-actor audit event carrying job provenance", async () => {
    const audit = new RecordingAudit();
    const processor = createHeartbeatProcessor(audit);
    await processor({ source: "worker-schedule", note: "integration beat" }, jobContext);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      module: "system",
      action: "system.heartbeat",
      actorType: "system",
      actorId: null,
      resourceType: "worker",
      details: {
        source: "worker-schedule",
        note: "integration beat",
        jobId: "job-7",
        attempt: 2,
      },
    });
  });

  it("rejects a malformed payload instead of writing a bogus audit row", async () => {
    const audit = new RecordingAudit();
    const processor = createHeartbeatProcessor(audit);
    await expect(processor({ note: 42 }, jobContext)).rejects.toThrow();
    expect(audit.events).toHaveLength(0);
  });

  it("propagates audit-write failures so BullMQ retries the job", async () => {
    const failing: AuditLogger = {
      record: async () => {
        throw new Error("postgres unavailable");
      },
    };
    const processor = createHeartbeatProcessor(failing);
    await expect(processor({ source: "worker-schedule" }, jobContext)).rejects.toThrow(
      /postgres unavailable/,
    );
  });
});
