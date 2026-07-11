import type { JobProcessor } from "@vidya/platform";
import type { ReportService } from "../service/report-service";
import { reportJobPayloadSchema } from "../definition";

/** Worker-side report generation — request only enqueues (ADR-0020). */
export function createReportProcessor(service: ReportService): JobProcessor {
  return async (payload, ctx) => {
    const input = reportJobPayloadSchema.parse(payload);
    await service.run(input.reportId, ctx.logger);
  };
}
