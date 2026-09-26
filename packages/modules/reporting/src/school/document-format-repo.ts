import { desc, eq, and, sql } from "drizzle-orm";
import type { Db, DurableAuditReceipt, TransactionalAuditLogger } from "@vidya/platform";
import { rptSchoolDocumentFormats, type RptSchoolDocumentFormatRow } from "../db/schema";
import type { DocumentFamily, DocumentStyle } from "./document-format";

export class DocumentFormatConflictError extends Error {
  constructor() { super("The school format changed. Reload it before saving."); }
}

export interface DocumentFormatRepo {
  latest(collegeId: string, family: DocumentFamily): Promise<RptSchoolDocumentFormatRow | null>;
  append(input: {
    collegeId: string; family: DocumentFamily; expectedVersion: number; style: DocumentStyle;
    sample: { key: string; filename: string; contentType: string } | null;
    actorId: string; requestId: string;
  }): Promise<{ row: RptSchoolDocumentFormatRow; receipt: DurableAuditReceipt }>;
}

export function createDocumentFormatRepo(db: Db, audit: TransactionalAuditLogger): DocumentFormatRepo {
  return {
    async latest(collegeId, family) {
      const [row] = await db.select().from(rptSchoolDocumentFormats)
        .where(and(eq(rptSchoolDocumentFormats.collegeId, collegeId), eq(rptSchoolDocumentFormats.family, family)))
        .orderBy(desc(rptSchoolDocumentFormats.version)).limit(1);
      return row ?? null;
    },
    async append(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.collegeId}), hashtext(${input.family}))`);
        const [previous] = await tx.select().from(rptSchoolDocumentFormats)
          .where(and(eq(rptSchoolDocumentFormats.collegeId, input.collegeId), eq(rptSchoolDocumentFormats.family, input.family)))
          .orderBy(desc(rptSchoolDocumentFormats.version)).limit(1);
        if ((previous?.version ?? 0) !== input.expectedVersion) throw new DocumentFormatConflictError();
        const sample = input.sample ?? (previous?.sampleKey ? {
          key: previous.sampleKey, filename: previous.sampleFilename!, contentType: previous.sampleContentType!,
        } : null);
        const [row] = await tx.insert(rptSchoolDocumentFormats).values({
          collegeId: input.collegeId, family: input.family, version: input.expectedVersion + 1,
          style: input.style, sampleKey: sample?.key ?? null, sampleFilename: sample?.filename ?? null,
          sampleContentType: sample?.contentType ?? null, changedBy: input.actorId,
        }).returning();
        const receipt = await audit.recordInTransaction(tx as unknown as Db, {
          module: "reporting", action: "reporting.school-document-format-saved", resourceType: "college",
          resourceId: input.collegeId, org: { collegeId: input.collegeId },
          actorType: "user", actorId: input.actorId, requestId: input.requestId,
          details: { routeId: "reporting.school-document-format-save", status: 200, family: input.family,
            version: row!.version, sampleFilename: sample?.filename ?? null },
        });
        return { row: row!, receipt };
      });
    },
  };
}
