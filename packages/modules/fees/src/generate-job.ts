import type { JobProcessor } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { invoiceGeneratePayloadSchema } from "./definition";
import type { FeesRepo, InvoiceTarget } from "./repo";

/**
 * Worker-side of invoice generation: one invoice per (enrolled student ×
 * structure) for the run's class/year. Idempotent — (studentId, structureId)
 * is unique, so re-running after new enrollments only invoices the new pairs.
 */
export function createGenerateProcessor(repo: FeesRepo, directory: PeopleDirectory): JobProcessor {
  return async (payload, ctx) => {
    const input = invoiceGeneratePayloadSchema.parse(payload);
    const run = await repo.getRun(input.runId);
    if (run === null) {
      ctx.logger.warn({ runId: input.runId }, "generation run vanished — nothing to do");
      return;
    }
    await repo.markRunning(run.id);
    try {
      const structures = await repo.listStructuresForClass(run.classId, run.academicYear);
      const students: InvoiceTarget[] = [];
      for (const section of await directory.sectionsOfClass(run.classId)) {
        for (const entry of await directory.sectionRoster(section.sectionId)) {
          if (entry.academicYear === run.academicYear) {
            students.push({ studentId: entry.studentId, sectionId: section.sectionId });
          }
        }
      }
      const { created, skipped } = await repo.createInvoicesForStructures(structures, students);
      await repo.finishRun(run.id, { status: "completed", invoicesCreated: created, invoicesSkipped: skipped, error: null });
      ctx.logger.info({ runId: run.id, created, skipped }, "invoice generation finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await repo.finishRun(run.id, { status: "failed", invoicesCreated: 0, invoicesSkipped: 0, error: message });
      ctx.logger.error({ runId: run.id, error: message }, "invoice generation failed");
    }
  };
}
