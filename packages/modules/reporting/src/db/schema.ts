import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { DocumentStyle } from "../school/document-format";
import type { CertificateSnapshot } from "../school/certificate-contract";

/**
 * INTERNAL to the reporting module (not exported from index.ts). One table,
 * "rpt_" prefix (Constitution rule 2; CI-checked). A report row is
 * bookkeeping for an artifact stored in MinIO; the artifact itself never
 * lives in Postgres. `requested_by` + `params` drive the scoped download
 * re-check (ADR-0020) — the object key is never the access control.
 */
export const rptReports = pgTable(
  "rpt_reports",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    format: text("format").notNull(),
    /** The report's target (studentId / sectionId / classId / level+nodeId). */
    params: jsonb("params").notNull(),
    academicYear: text("academic_year").notNull(),
    /** Requester's scope snapshot at request time (roles + grants). The
     *  worker generates WITH this scope; the download handler re-checks the
     *  requester's CURRENT scope, so a later scope loss revokes access. */
    requesterPrincipal: jsonb("requester_principal").notNull(),
    status: text("status").notNull().default("pending"),
    objectKey: text("object_key"),
    rows: integer("rows").notNull().default(0),
    error: text("error"),
    requestedBy: text("requested_by").notNull(),
    documentStyle: jsonb("document_style").$type<DocumentStyle | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("rpt_reports_requester_idx").on(table.requestedBy, table.createdAt)],
);

export type RptReportRow = typeof rptReports.$inferSelect;

/**
 * INTERNAL to the reporting module. Immutable school report-card snapshots,
 * "rpt_" prefix (Constitution rule 2; CI-checked).
 *
 * A snapshot is the PERMANENT record of what a report card said when it was
 * generated. `payload` holds the fully-computed academic content — subject
 * percentages, grades, the overall figure, the attendance summary, the
 * warnings shown to the generating user, and the engine/policy versions that
 * produced them. The PDF is rendered FROM this payload and never by
 * recomputation, so reprinting a year later reproduces the original document
 * even if marks were corrected afterwards.
 *
 * Immutability is enforced in the database by a trigger (see the paired
 * migration), not merely by this module declining to write an UPDATE.
 * Correcting a report card means generating a NEW snapshot; the superseded
 * row stays exactly as issued. Nothing is ever hard-deleted.
 *
 * The stored org path is what the download handler re-checks the caller's
 * CURRENT scope against — the snapshot id is never the access control
 * (ADR-0020).
 */
export const rptSchoolReportCards = pgTable(
  "rpt_school_report_cards",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull(),
    termId: text("term_id").notNull(),
    academicYear: text("academic_year").notNull(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    classId: text("class_id").notNull(),
    sectionId: text("section_id"),
    /** The frozen, fully-computed report-card content. */
    payload: jsonb("payload").notNull(),
    documentStyle: jsonb("document_style").$type<DocumentStyle | null>(),
    generatedBy: text("generated_by").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("rpt_school_report_cards_student_term_idx").on(
      table.studentId,
      table.termId,
      table.generatedAt,
    ),
    index("rpt_school_report_cards_class_term_idx").on(table.classId, table.termId),
  ],
);

export type RptSchoolReportCardRow = typeof rptSchoolReportCards.$inferSelect;

/** Publication is an append-only decision, separate from the immutable card.
 * The newest event for a pupil and term decides what families can currently see. */
export const rptSchoolReportCardPublications = pgTable(
  "rpt_school_report_card_publications",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    studentId: text("student_id").notNull(),
    termId: text("term_id").notNull(),
    snapshotId: text("snapshot_id").references(() => rptSchoolReportCards.id),
    action: text("action").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("rpt_rc_publications_student_term_idx").on(table.studentId, table.termId, table.id)],
);

export type RptSchoolReportCardPublicationRow = typeof rptSchoolReportCardPublications.$inferSelect;

export const rptSchoolDocumentFormats = pgTable("rpt_school_document_formats", {
  collegeId: text("college_id").notNull(),
  family: text("family").notNull(),
  version: integer("version").notNull(),
  style: jsonb("style").$type<DocumentStyle>().notNull(),
  sampleKey: text("sample_key"),
  sampleFilename: text("sample_filename"),
  sampleContentType: text("sample_content_type"),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.collegeId, table.family, table.version] })]);

export type RptSchoolDocumentFormatRow = typeof rptSchoolDocumentFormats.$inferSelect;

/** Frozen, append-only school certificates. No cross-module foreign keys. */
export const rptSchoolCertificates = pgTable("rpt_school_certificates", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull(),
  academicYear: text("academic_year").notNull(),
  sequence: integer("sequence").notNull(),
  number: text("number").notNull(),
  studentId: text("student_id").notNull(),
  enrollmentId: text("enrollment_id").notNull(),
  departmentId: text("department_id").notNull(),
  classId: text("class_id").notNull(),
  sectionId: text("section_id").notNull(),
  kind: text("kind").$type<"bonafide" | "transfer">().notNull(),
  payload: jsonb("payload").$type<CertificateSnapshot>().notNull(),
  correctionOfId: text("correction_of_id"),
  requestId: text("request_id").notNull(),
  issuedBy: text("issued_by").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("rpt_school_certificates_student_idx").on(table.studentId, table.issuedAt),
]);

export type RptSchoolCertificateRow = typeof rptSchoolCertificates.$inferSelect;
