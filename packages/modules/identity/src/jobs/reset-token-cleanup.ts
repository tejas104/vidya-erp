import type { AuditLogger, JobProcessor } from "@vidya/platform";
import type { ResetTokensRepo } from "../repo/reset-tokens-repo";
import { resetCleanupPayloadSchema } from "../definition";

/**
 * Removes expired and already-used password-reset tokens. Audits only when
 * something was actually deleted (a state change); a no-op sweep is not a
 * state change and stays out of the audit trail.
 */
export function createResetCleanupProcessor(
  resetTokens: ResetTokensRepo,
  audit: AuditLogger,
): JobProcessor {
  return async (payload, ctx) => {
    const input = resetCleanupPayloadSchema.parse(payload);
    const removed = await resetTokens.deleteStale(new Date());
    if (removed > 0) {
      await audit.record({
        module: "identity",
        action: "identity.reset-tokens-purged",
        actorType: "system",
        actorId: null,
        resourceType: "reset-token",
        resourceId: null,
        requestId: null,
        details: { removed, source: input.source, jobId: ctx.jobId },
      });
    }
    ctx.logger.info({ removed }, "reset-token cleanup finished");
  };
}
