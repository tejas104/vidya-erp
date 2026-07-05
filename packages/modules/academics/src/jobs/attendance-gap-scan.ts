import type { JobProcessor } from "@vidya/platform";
import type { AttendanceService } from "../service/attendance-service";
import { gapScanPayloadSchema } from "../definition";

/**
 * Daily worker job: sections with live enrollment but no attendance
 * session for the day. Detected gaps are audited (with a capped section
 * list) so the office has a durable record to chase; a complete college
 * stays silent.
 */
export function createGapScanProcessor(attendance: AttendanceService): JobProcessor {
  return async (payload, ctx) => {
    const input = gapScanPayloadSchema.parse(payload);
    const date = input.date ?? new Date().toISOString().slice(0, 10);
    await attendance.gapScan(date, ctx.logger);
  };
}
