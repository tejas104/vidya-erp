import type { JobProcessor } from "@vidya/platform";
import type { AssignmentsService } from "../service/assignments-service";
import { reconcileJobPayloadSchema } from "../definition";

/**
 * The ADR-0015 safety net: assignments are the source of truth; derived
 * grants converge to them. Repairs are audited by the service; a clean
 * pass logs and does nothing else.
 */
export function createReconcileProcessor(assignments: AssignmentsService): JobProcessor {
  return async (payload, ctx) => {
    const input = reconcileJobPayloadSchema.parse(payload);
    const result = await assignments.reconcile();
    ctx.logger.info(
      { upserted: result.upserted, removed: result.removed, source: input.source },
      "grant reconciliation finished",
    );
  };
}
