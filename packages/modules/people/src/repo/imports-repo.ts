import { eq } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { newId } from "../ids";
import { pplImports, type PplImportRow } from "../db/schema";

export type ImportKind = "students" | "teachers";
export type ImportStatus = "pending" | "running" | "completed" | "failed";

export interface RowError {
  readonly row: number;
  readonly message: string;
}

export interface ImportsRepo {
  create(input: {
    kind: ImportKind;
    collegeId: string;
    academicYear?: string;
    dryRun: boolean;
    objectKey: string;
    requestedBy: string;
  }): Promise<PplImportRow>;
  get(id: string): Promise<PplImportRow | null>;
  markRunning(id: string): Promise<void>;
  finish(
    id: string,
    outcome: {
      status: Extract<ImportStatus, "completed" | "failed">;
      totalRows: number;
      okRows: number;
      errorRows: number;
      errors: readonly RowError[];
    },
  ): Promise<void>;
}

export function createImportsRepo(db: Db): ImportsRepo {
  return {
    async create(input) {
      const rows = await db
        .insert(pplImports)
        .values({
          id: newId("imp"),
          kind: input.kind,
          collegeId: input.collegeId,
          academicYear: input.academicYear ?? null,
          dryRun: input.dryRun,
          objectKey: input.objectKey,
          requestedBy: input.requestedBy,
        })
        .returning();
      return rows[0]!;
    },

    async get(id) {
      const rows = await db.select().from(pplImports).where(eq(pplImports.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async markRunning(id) {
      await db.update(pplImports).set({ status: "running" }).where(eq(pplImports.id, id));
    },

    async finish(id, outcome) {
      await db
        .update(pplImports)
        .set({
          status: outcome.status,
          totalRows: outcome.totalRows,
          okRows: outcome.okRows,
          errorRows: outcome.errorRows,
          errors: outcome.errors,
          finishedAt: new Date(),
        })
        .where(eq(pplImports.id, id));
    },
  };
}
