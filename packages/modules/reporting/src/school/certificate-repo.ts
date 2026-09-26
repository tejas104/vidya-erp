import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PeopleDirectory, CertificateSource } from "@vidya/module-people";
import type { Db, DurableAuditReceipt, OrgPath, TransactionalAuditLogger } from "@vidya/platform";
import { rptSchoolCertificates, rptSchoolDocumentFormats, type RptSchoolCertificateRow } from "../db/schema";
import { CERTIFICATE_SNAPSHOT_VERSION, certificateSnapshotSchema } from "./certificate-contract";
import { DEFAULT_DOCUMENT_STYLE } from "./document-format";

export class CertificateIssueConflict extends Error {
  constructor(message: string) { super(message); this.name = "CertificateIssueConflict"; }
}
export class CertificateSourceUnavailable extends Error {
  constructor() { super("The pupil or verified enrollment is unavailable."); this.name = "CertificateSourceUnavailable"; }
}
export class CertificateIssueDenied extends Error {
  constructor() { super("The pupil is outside your school scope."); this.name = "CertificateIssueDenied"; }
}

/** One sequence across both certificate kinds within a school/year. */
export function certificateNumber(academicYear: string, sequence: number): string {
  if (!/^\d{4}-\d{2}$/.test(academicYear) || !Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999999) {
    throw new CertificateIssueConflict("The certificate sequence or academic year is invalid.");
  }
  return `CERT/${academicYear}/${String(sequence).padStart(6, "0")}`;
}

/** Pure source rule. A corrected transfer cannot be certified as a live exit. */
export function assertCertificateSource(kind: "bonafide" | "transfer", source: CertificateSource): void {
  if (kind === "bonafide") return;
  const row = source.enrollment;
  if (row.status !== "withdrawn" || row.outcome !== "transferred_out" || row.corrected ||
      row.endsOn === null || row.outcomeReason === null || row.outcomeReason.trim().length < 3) {
    throw new CertificateIssueConflict("A current, recorded transfer with a leaving date and reason is required.");
  }
}

export interface CertificateIssueInput {
  readonly studentId: string;
  readonly enrollmentId: string;
  readonly kind: "bonafide" | "transfer";
  readonly correctionOfId: string | null;
  readonly issuedBy: "admin" | "principal";
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly auditRequestId: string;
  /** Invoked with the source row's trusted org path inside the transaction. */
  readonly authorize: (org: OrgPath) => boolean;
}

export interface CertificateRepo {
  issue(input: CertificateIssueInput): Promise<{ row: RptSchoolCertificateRow; receipt: DurableAuditReceipt | null; replay: boolean }>;
  get(id: string): Promise<RptSchoolCertificateRow | null>;
  list(studentId: string): Promise<RptSchoolCertificateRow[]>;
}

export function createCertificateRepo(db: Db, audit: TransactionalAuditLogger, directory: PeopleDirectory): CertificateRepo {
  return {
    async get(id) {
      const [row] = await db.select().from(rptSchoolCertificates).where(eq(rptSchoolCertificates.id, id)).limit(1);
      return row ?? null;
    },
    list(studentId) {
      return db.select().from(rptSchoolCertificates).where(eq(rptSchoolCertificates.studentId, studentId))
        .orderBy(desc(rptSchoolCertificates.issuedAt));
    },
    issue(input) {
      return db.transaction(async (tx) => {
        const handle = tx as unknown as Db;
        const source = await directory.certificateSourceInTransaction(handle, input.studentId, input.enrollmentId);
        if (source === null) throw new CertificateSourceUnavailable();
        if (!input.authorize(source.org)) throw new CertificateIssueDenied();
        const collegeId = source.org.collegeId;
        // Lock the key before the year so even a reused key across different
        // years returns a conflict instead of a late unique-constraint error.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${collegeId}), hashtext(${input.idempotencyKey}))`);
        // This lock serializes number allocation for both kinds in a school/year.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${collegeId}), hashtext(${source.enrollment.academicYear}))`);
        const [previousRequest] = await tx.select().from(rptSchoolCertificates).where(and(
          eq(rptSchoolCertificates.collegeId, collegeId), eq(rptSchoolCertificates.requestId, input.idempotencyKey),
        )).limit(1);
        if (previousRequest) {
          if (previousRequest.studentId !== input.studentId || previousRequest.enrollmentId !== input.enrollmentId ||
              previousRequest.kind !== input.kind || previousRequest.correctionOfId !== input.correctionOfId) {
            throw new CertificateIssueConflict("This request key was used for a different certificate.");
          }
          return { row: previousRequest, receipt: null, replay: true };
        }
        assertCertificateSource(input.kind, source);
        let correctionOfNumber: string | null = null;
        if (input.correctionOfId !== null) {
          const [original] = await tx.select().from(rptSchoolCertificates).where(and(
            eq(rptSchoolCertificates.id, input.correctionOfId), eq(rptSchoolCertificates.collegeId, collegeId),
          )).for("share");
          if (!original || original.studentId !== input.studentId || original.kind !== input.kind ||
              original.enrollmentId !== input.enrollmentId) {
            throw new CertificateIssueConflict("The certificate to correct does not match this pupil and enrollment.");
          }
          const [existingCorrection] = await tx.select({ id: rptSchoolCertificates.id }).from(rptSchoolCertificates)
            .where(and(eq(rptSchoolCertificates.collegeId, collegeId),
              eq(rptSchoolCertificates.correctionOfId, input.correctionOfId))).limit(1);
          if (existingCorrection) throw new CertificateIssueConflict("This certificate was already corrected. Correct the latest version instead.");
          correctionOfNumber = original.number;
        }
        const [last] = await tx.select({ sequence: rptSchoolCertificates.sequence }).from(rptSchoolCertificates)
          .where(and(eq(rptSchoolCertificates.collegeId, collegeId),
            eq(rptSchoolCertificates.academicYear, source.enrollment.academicYear)))
          .orderBy(desc(rptSchoolCertificates.sequence)).limit(1);
        const sequence = (last?.sequence ?? 0) + 1;
        const number = certificateNumber(source.enrollment.academicYear, sequence);
        const [format] = await tx.select().from(rptSchoolDocumentFormats).where(and(
          eq(rptSchoolDocumentFormats.collegeId, collegeId), eq(rptSchoolDocumentFormats.family, "certificate"),
        )).orderBy(desc(rptSchoolDocumentFormats.version)).limit(1);
        const issuedAt = new Date();
        const common = {
          snapshotVersion: CERTIFICATE_SNAPSHOT_VERSION, schoolId: collegeId,
          studentId: source.student.id, enrollmentId: source.enrollment.id, number,
          academicYear: source.enrollment.academicYear, issuedAt: issuedAt.toISOString(),
          issuedBy: input.issuedBy, correctionOfNumber,
          student: { fullName: source.student.fullName, admissionNo: source.student.admissionNo },
          enrollment: { className: source.enrollment.className, sectionName: source.enrollment.sectionName,
            startsOn: source.enrollment.startsOn, endsOn: source.enrollment.endsOn },
          style: format?.style ?? { ...DEFAULT_DOCUMENT_STYLE, schoolName: source.schoolName },
        };
        const payload = certificateSnapshotSchema.parse(input.kind === "transfer" ? {
          ...common, kind: "transfer", leavingOn: source.enrollment.endsOn,
          leavingReason: source.enrollment.outcomeReason, source: { kind: "recorded_transfer" },
        } : { ...common, kind: "bonafide" });
        const [row] = await tx.insert(rptSchoolCertificates).values({
          id: `cer_${randomUUID()}`, collegeId, academicYear: source.enrollment.academicYear,
          sequence, number, studentId: input.studentId, enrollmentId: input.enrollmentId,
          departmentId: source.org.departmentId, classId: source.org.classId,
          sectionId: source.org.sectionId, kind: input.kind, payload,
          correctionOfId: input.correctionOfId, requestId: input.idempotencyKey,
          issuedBy: input.actorId, issuedAt,
        }).returning();
        const receipt = await audit.recordInTransaction(handle, {
          module: "reporting", action: "reporting.school-certificate-issue-requested", resourceType: "certificate",
          resourceId: row!.id, org: source.org, actorType: "user", actorId: input.actorId,
          requestId: input.auditRequestId,
          details: { routeId: "reporting.school-certificate-issue", status: 201, kind: input.kind,
            studentId: input.studentId, enrollmentId: input.enrollmentId, number,
            correctionOfId: input.correctionOfId, source: input.kind === "transfer" ? "recorded_transfer" : "enrollment" },
        });
        return { row: row!, receipt, replay: false };
      });
    },
  };
}
