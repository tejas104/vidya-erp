import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { AuditLogger, Logger } from "@vidya/platform";
import type { OrgRepo } from "../repo/org-repo";
import type { PeopleRepo } from "../repo/people-repo";
import type { ImportKind, ImportsRepo, RowError } from "../repo/imports-repo";
import type { PplImportRow } from "../db/schema";
import { UnknownReferenceError } from "./people-service";

/**
 * Bulk CSV import (assignment #3): request-side validation + upload here,
 * heavy lifting in the worker (import-job.ts). CSV only — colleges export
 * CSV from Excel (approved decision; ADR-0009 for csv-parse).
 *
 * Student columns: admission_no, full_name and OPTIONALLY the enrollment
 * trio department_code, class_code, section_name (requires the import's
 * academicYear). Teacher columns: staff_no, full_name.
 *
 * Row failures never abort the run: each row is validated and applied
 * independently, errors are reported per row (capped), and the audit trail
 * records who imported what with which outcome.
 */

const MAX_ROW_ERRORS = 500;

const studentRowSchema = z.object({
  admission_no: z.string().trim().min(1).max(64),
  full_name: z.string().trim().min(1).max(128),
  department_code: z.string().trim().max(64).optional().default(""),
  class_code: z.string().trim().max(64).optional().default(""),
  section_name: z.string().trim().max(64).optional().default(""),
});

const teacherRowSchema = z.object({
  staff_no: z.string().trim().min(1).max(64),
  full_name: z.string().trim().min(1).max(128),
});

/** Object-storage port; the module factory adapts the platform S3 client. */
export interface ImportObjectStore {
  putText(key: string, body: string): Promise<void>;
  getText(key: string): Promise<string>;
}

export interface ImportServiceDeps {
  readonly imports: ImportsRepo;
  readonly people: PeopleRepo;
  readonly orgRepo: OrgRepo;
  readonly store: ImportObjectStore;
  readonly audit: AuditLogger;
  readonly onFinished?: (kind: ImportKind, status: "completed" | "failed") => void;
}

export class ImportService {
  constructor(private readonly deps: ImportServiceDeps) {}

  /** Request side: validate, store the CSV, create the bookkeeping row. */
  async createImport(input: {
    kind: ImportKind;
    collegeId: string;
    academicYear?: string;
    csv: string;
    dryRun: boolean;
    requestedBy: string;
  }): Promise<PplImportRow> {
    if ((await this.deps.orgRepo.getCollege(input.collegeId)) === null) {
      throw new UnknownReferenceError(`collegeId "${input.collegeId}"`);
    }
    const objectKey = `imports/${randomUUID()}.csv`;
    await this.deps.store.putText(objectKey, input.csv);
    return this.deps.imports.create({
      kind: input.kind,
      collegeId: input.collegeId,
      ...(input.academicYear !== undefined ? { academicYear: input.academicYear } : {}),
      dryRun: input.dryRun,
      objectKey,
      requestedBy: input.requestedBy,
    });
  }

  getImport(id: string): Promise<PplImportRow | null> {
    return this.deps.imports.get(id);
  }

  /** Worker side: parse, validate, dry-run or apply, record the outcome. */
  async run(importId: string, log: Logger): Promise<void> {
    const imp = await this.deps.imports.get(importId);
    if (imp === null) {
      log.warn({ importId }, "import job for unknown import id — skipping");
      return;
    }
    if (imp.status === "completed") {
      log.info({ importId }, "import already completed — skipping");
      return;
    }
    await this.deps.imports.markRunning(importId);

    try {
      const csv = await this.deps.store.getText(imp.objectKey);
      const records = parse(csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }) as Record<string, string>[];

      const outcome =
        imp.kind === "students"
          ? await this.processStudents(imp, records)
          : await this.processTeachers(imp, records);

      await this.deps.imports.finish(importId, {
        status: "completed",
        totalRows: records.length,
        okRows: outcome.ok,
        errorRows: outcome.errors.length,
        errors: outcome.errors.slice(0, MAX_ROW_ERRORS),
      });
      await this.deps.audit.record({
        module: "people",
        action: "people.import-completed",
        actorType: "user",
        actorId: imp.requestedBy,
        resourceType: "import",
        resourceId: importId,
        requestId: null,
        details: {
          kind: imp.kind,
          collegeId: imp.collegeId,
          dryRun: imp.dryRun,
          totalRows: records.length,
          okRows: outcome.ok,
          errorRows: outcome.errors.length,
        },
      });
      this.deps.onFinished?.(imp.kind as ImportKind, "completed");
      log.info(
        { importId, total: records.length, ok: outcome.ok, errors: outcome.errors.length },
        "import finished",
      );
    } catch (error) {
      await this.deps.imports.finish(importId, {
        status: "failed",
        totalRows: 0,
        okRows: 0,
        errorRows: 0,
        errors: [{ row: 0, message: error instanceof Error ? error.message : "import failed" }],
      });
      await this.deps.audit.record({
        module: "people",
        action: "people.import-failed",
        actorType: "user",
        actorId: imp.requestedBy,
        resourceType: "import",
        resourceId: importId,
        requestId: null,
        details: { kind: imp.kind, collegeId: imp.collegeId },
      });
      this.deps.onFinished?.(imp.kind as ImportKind, "failed");
      throw error;
    }
  }

  private async processStudents(
    imp: PplImportRow,
    records: Record<string, string>[],
  ): Promise<{ ok: number; errors: RowError[] }> {
    const errors: RowError[] = [];
    // Section lookup by (department_code, class_code, section_name) — one
    // tree read instead of per-row queries.
    const tree = await this.deps.orgRepo.getTree(imp.collegeId);
    const sectionByCodes = new Map<string, string>();
    for (const department of tree?.departments ?? []) {
      for (const classRow of department.classes) {
        for (const section of classRow.sections) {
          sectionByCodes.set(`${department.code}/${classRow.code}/${section.name}`, section.id);
        }
      }
    }

    interface ValidStudentRow {
      row: number;
      admissionNo: string;
      fullName: string;
      sectionId?: string;
    }
    const valid: ValidStudentRow[] = [];
    const seenInFile = new Set<string>();

    records.forEach((record, index) => {
      const rowNumber = index + 2; // header is row 1
      const parsed = studentRowSchema.safeParse(record);
      if (!parsed.success) {
        errors.push({
          row: rowNumber,
          message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        });
        return;
      }
      const row = parsed.data;
      if (seenInFile.has(row.admission_no)) {
        errors.push({ row: rowNumber, message: `duplicate admission_no "${row.admission_no}" in file` });
        return;
      }
      seenInFile.add(row.admission_no);

      const trio = [row.department_code, row.class_code, row.section_name];
      const provided = trio.filter((part) => part !== "").length;
      let sectionId: string | undefined;
      if (provided > 0 && provided < 3) {
        errors.push({
          row: rowNumber,
          message: "enrollment requires all of department_code, class_code and section_name",
        });
        return;
      }
      if (provided === 3) {
        if (imp.academicYear === null) {
          errors.push({ row: rowNumber, message: "import has no academicYear; enrollment columns cannot be used" });
          return;
        }
        sectionId = sectionByCodes.get(trio.join("/"));
        if (sectionId === undefined) {
          errors.push({ row: rowNumber, message: `no such section "${trio.join("/")}" in this college` });
          return;
        }
      }
      valid.push({ row: rowNumber, admissionNo: row.admission_no, fullName: row.full_name, sectionId });
    });

    const existing = await this.deps.people.findExistingAdmissionNos(
      imp.collegeId,
      valid.map((row) => row.admissionNo),
    );
    const applicable = valid.filter((row) => {
      if (existing.has(row.admissionNo)) {
        errors.push({ row: row.row, message: `admission_no "${row.admissionNo}" already exists` });
        return false;
      }
      return true;
    });

    if (imp.dryRun) {
      return { ok: applicable.length, errors };
    }

    let ok = 0;
    for (const row of applicable) {
      try {
        const student = await this.deps.people.createStudent({
          collegeId: imp.collegeId,
          admissionNo: row.admissionNo,
          fullName: row.fullName,
          sourceImportId: imp.id,
        });
        if (row.sectionId !== undefined && imp.academicYear !== null) {
          try {
            await this.deps.people.createEnrollment({
              studentId: student.id,
              sectionId: row.sectionId,
              academicYear: imp.academicYear,
            });
          } catch (error) {
            errors.push({
              row: row.row,
              message: `student created but enrollment failed: ${error instanceof Error ? error.message : "unknown error"}`,
            });
            continue;
          }
        }
        ok += 1;
      } catch (error) {
        errors.push({
          row: row.row,
          message: error instanceof Error ? error.message : "insert failed",
        });
      }
    }
    return { ok, errors };
  }

  private async processTeachers(
    imp: PplImportRow,
    records: Record<string, string>[],
  ): Promise<{ ok: number; errors: RowError[] }> {
    const errors: RowError[] = [];
    interface ValidTeacherRow {
      row: number;
      staffNo: string;
      fullName: string;
    }
    const valid: ValidTeacherRow[] = [];
    const seenInFile = new Set<string>();

    records.forEach((record, index) => {
      const rowNumber = index + 2;
      const parsed = teacherRowSchema.safeParse(record);
      if (!parsed.success) {
        errors.push({
          row: rowNumber,
          message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        });
        return;
      }
      if (seenInFile.has(parsed.data.staff_no)) {
        errors.push({ row: rowNumber, message: `duplicate staff_no "${parsed.data.staff_no}" in file` });
        return;
      }
      seenInFile.add(parsed.data.staff_no);
      valid.push({ row: rowNumber, staffNo: parsed.data.staff_no, fullName: parsed.data.full_name });
    });

    const existing = await this.deps.people.findExistingStaffNos(
      imp.collegeId,
      valid.map((row) => row.staffNo),
    );
    const applicable = valid.filter((row) => {
      if (existing.has(row.staffNo)) {
        errors.push({ row: row.row, message: `staff_no "${row.staffNo}" already exists` });
        return false;
      }
      return true;
    });

    if (imp.dryRun) {
      return { ok: applicable.length, errors };
    }

    let ok = 0;
    for (const row of applicable) {
      try {
        await this.deps.people.createTeacher({
          collegeId: imp.collegeId,
          staffNo: row.staffNo,
          fullName: row.fullName,
          sourceImportId: imp.id,
        });
        ok += 1;
      } catch (error) {
        errors.push({
          row: row.row,
          message: error instanceof Error ? error.message : "insert failed",
        });
      }
    }
    return { ok, errors };
  }
}
