import type { JobProcessor } from "@vidya/platform";
import type { ImportService } from "../service/import-service";
import { importJobPayloadSchema } from "../definition";

/** Worker-side of the bulk import: the request only uploads and enqueues. */
export function createImportProcessor(imports: ImportService): JobProcessor {
  return async (payload, ctx) => {
    const input = importJobPayloadSchema.parse(payload);
    await imports.run(input.importId, ctx.logger);
  };
}
