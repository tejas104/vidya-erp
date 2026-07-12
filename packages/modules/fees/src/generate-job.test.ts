import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { PeopleDirectory } from "@vidya/module-people";
import { createGenerateProcessor } from "./generate-job";
import type { FeesRepo } from "./repo";

const logger = pino({ level: "silent" });
const jobCtx = { logger, jobId: "j1", attempt: 1 } as never;

const run = {
  id: "fgr_1", collegeId: "col_1", classId: "cls_1", academicYear: "2026-27",
  status: "pending" as const, invoicesCreated: 0, invoicesSkipped: 0, error: null,
  requestedBy: "u_adm", createdAt: new Date(), finishedAt: null,
};
const structure = {
  id: "fst_1", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", headId: "fhd_1",
  academicYear: "2026-27", amount: 50_000, dueOn: "2026-08-01", installmentNo: 1, createdAt: new Date(),
};

function makeFakes(opts: { fail?: boolean } = {}) {
  const finished: unknown[] = [];
  const invoiced: unknown[] = [];
  const repo = {
    getRun: async () => run,
    markRunning: async () => undefined,
    listStructuresForClass: async () => [structure],
    createInvoicesForStructures: async (structures: unknown[], students: unknown[]) => {
      if (opts.fail) throw new Error("db exploded");
      invoiced.push([structures, students]);
      return { created: students.length * structures.length, skipped: 0 };
    },
    finishRun: async (_id: string, outcome: unknown) => { finished.push(outcome); },
  } as unknown as FeesRepo;
  const directory = {
    sectionsOfClass: async () => [{ sectionId: "sec_1", name: "A" }],
    sectionRoster: async () => [
      { studentId: "stu_1", academicYear: "2026-27" },
      { studentId: "stu_2", academicYear: "2025-26" }, // stale enrollment — must be skipped
    ],
  } as unknown as PeopleDirectory;
  return { repo, directory, finished, invoiced };
}

describe("invoice-generate job", () => {
  it("invoices only the run-year enrollments and completes the run", async () => {
    const { repo, directory, finished, invoiced } = makeFakes();
    await createGenerateProcessor(repo, directory)({ runId: "fgr_1" }, jobCtx);
    expect(invoiced).toHaveLength(1);
    const [, students] = invoiced[0] as [unknown[], { studentId: string }[]];
    expect(students).toEqual([{ studentId: "stu_1", sectionId: "sec_1" }]);
    expect(finished).toEqual([{ status: "completed", invoicesCreated: 1, invoicesSkipped: 0, error: null }]);
  });

  it("marks the run failed with the error message on a crash", async () => {
    const { repo, directory, finished } = makeFakes({ fail: true });
    await createGenerateProcessor(repo, directory)({ runId: "fgr_1" }, jobCtx);
    expect(finished).toEqual([{ status: "failed", invoicesCreated: 0, invoicesSkipped: 0, error: "db exploded" }]);
  });
});
