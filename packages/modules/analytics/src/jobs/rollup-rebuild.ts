import type { JobProcessor } from "@vidya/platform";
import type { RollupBuilder } from "../service/rollup-builder";
import { academicYearForDate, rollupJobPayloadSchema } from "../definition";

/** Nightly (and on-demand) rollup rebuild — blind compute, ADR-0018. */
export function createRollupProcessor(builder: RollupBuilder): JobProcessor {
  return async (payload, ctx) => {
    const input = rollupJobPayloadSchema.parse(payload);
    const academicYear = input.academicYear ?? academicYearForDate(new Date());
    await builder.build(academicYear, ctx.logger);
  };
}
