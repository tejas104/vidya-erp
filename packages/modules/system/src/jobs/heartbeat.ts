import type { AuditLogger, JobProcessor } from "@vidya/platform";
import { heartbeatPayloadSchema } from "../definition";

/**
 * The reference background job: writes a real row to the append-only audit
 * log. Exists to prove the full enqueue → Redis → BullMQ worker → Postgres
 * path with production wiring (validated payload, retries, metrics).
 */
export function createHeartbeatProcessor(audit: AuditLogger): JobProcessor {
  return async (payload, ctx) => {
    // The queue dispatcher has already validated against the JobSpec schema;
    // parsing again here gives this function a typed, self-sufficient contract.
    const beat = heartbeatPayloadSchema.parse(payload);
    await audit.record({
      module: "system",
      action: "system.heartbeat",
      actorType: "system",
      actorId: null,
      resourceType: "worker",
      resourceId: null,
      requestId: null,
      details: {
        source: beat.source,
        ...(beat.note !== undefined ? { note: beat.note } : {}),
        jobId: ctx.jobId,
        attempt: ctx.attempt,
      },
    });
    ctx.logger.info({ source: beat.source }, "heartbeat audited");
  };
}
