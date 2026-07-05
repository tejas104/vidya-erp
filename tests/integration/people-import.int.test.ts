import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { IMPORT_JOB_NAME } from "@vidya/module-people";
import { buildStack, type Stack } from "./support/harness";

/**
 * Bulk CSV import end to end: handler → MinIO object → worker processor →
 * rows + audit. Requires S3 (MinIO): runs in CI and against the compose
 * stack; skipped when INTEGRATION_S3=false is set for a services-only run.
 */
const s3Enabled = process.env.INTEGRATION_S3 !== "false";

let stack: Stack;
let collegeId = "";
let adminCookie = "";
let departmentCode = "";
let classCode = "";
const runId = randomUUID().slice(0, 8);
const log = pino({ level: "silent" });

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  collegeId = bootstrap.collegeId;
  adminCookie = bootstrap.adminCookie;

  departmentCode = `IMP-${runId}`;
  classCode = `IMPC-${runId}`;
  const dept = await stack.call("people.department-create", {
    cookie: adminCookie,
    body: { collegeId, name: `Imports ${runId}`, code: departmentCode },
  });
  const departmentId = ((await dept.json()) as { id: string }).id;
  const classResponse = await stack.call("people.class-create", {
    cookie: adminCookie,
    body: { departmentId, name: "Import Class", code: classCode },
  });
  const classId = ((await classResponse.json()) as { id: string }).id;
  await stack.call("people.section-create", {
    cookie: adminCookie,
    body: { classId, name: "A" },
  });
});

afterAll(async () => {
  await stack.close();
});

async function runImport(body: {
  kind: "students" | "teachers";
  academicYear?: string;
  dryRun: boolean;
  csv: string;
}): Promise<{ importId: string; state: Record<string, unknown> }> {
  const accepted = await stack.call("people.import-create", {
    cookie: adminCookie,
    body: { ...body, collegeId },
  });
  expect(accepted.status).toBe(202);
  const { importId } = (await accepted.json()) as { importId: string };
  expect(stack.enqueuedImports.map((entry) => entry.importId)).toContain(importId);

  await stack.people.jobProcessors[IMPORT_JOB_NAME]!(
    { importId, source: "integration-test" },
    { logger: log, jobId: "job-imp", attempt: 1 },
  );

  const stateResponse = await stack.call("people.import-get", {
    cookie: adminCookie,
    params: { importId },
  });
  expect(stateResponse.status).toBe(200);
  return { importId, state: (await stateResponse.json()) as Record<string, unknown> };
}

describe.skipIf(!s3Enabled)("bulk CSV import through MinIO + the worker processor", () => {
  it("dry-run validates, reports counts and per-row errors, writes nothing", async () => {
    const csv = [
      "admission_no,full_name,department_code,class_code,section_name",
      `D${runId}-1,Meera Nair,${departmentCode},${classCode},A`,
      `D${runId}-1,Duplicate In File,,,`,
      `D${runId}-2,Bad Section,${departmentCode},${classCode},Z`,
    ].join("\n");
    const { state } = await runImport({ kind: "students", academicYear: "2026-27", dryRun: true, csv });
    expect(state).toMatchObject({ status: "completed", dryRun: true, totalRows: 3, okRows: 1, errorRows: 2 });
    const check = await stack.pool.query(
      "SELECT count(*)::int AS count FROM ppl_students WHERE admission_no LIKE $1",
      [`D${runId}-%`],
    );
    expect(check.rows[0]).toEqual({ count: 0 });
  });

  it("applies a real student import with enrollment and audits it", async () => {
    const csv = [
      "admission_no,full_name,department_code,class_code,section_name",
      `R${runId}-1,Meera Nair,${departmentCode},${classCode},A`,
      `R${runId}-2,Ravi Kumar,,,`,
    ].join("\n");
    const { importId, state } = await runImport({
      kind: "students",
      academicYear: "2026-27",
      dryRun: false,
      csv,
    });
    expect(state).toMatchObject({ status: "completed", okRows: 2, errorRows: 0 });

    const students = await stack.pool.query(
      "SELECT admission_no, source_import_id FROM ppl_students WHERE admission_no LIKE $1 ORDER BY admission_no",
      [`R${runId}-%`],
    );
    expect(students.rows).toHaveLength(2);
    expect(students.rows[0]).toMatchObject({ source_import_id: importId });

    const enrollments = await stack.pool.query(
      `SELECT count(*)::int AS count FROM ppl_enrollments e
       JOIN ppl_students s ON s.id = e.student_id
       WHERE s.admission_no = $1 AND e.status = 'enrolled'`,
      [`R${runId}-1`],
    );
    expect(enrollments.rows[0]).toEqual({ count: 1 });

    const actions = (await stack.system.service.readRecentAuditEvents(10)).map((row) => row.action);
    expect(actions).toContain("people.import-completed");
    expect(actions).toContain("people.import-requested");
  });

  it("imports teachers and reports pre-existing staff numbers", async () => {
    const first = await runImport({
      kind: "teachers",
      dryRun: false,
      csv: ["staff_no,full_name", `T${runId}-1,Asha Verma`].join("\n"),
    });
    expect(first.state).toMatchObject({ okRows: 1, errorRows: 0 });

    const second = await runImport({
      kind: "teachers",
      dryRun: false,
      csv: ["staff_no,full_name", `T${runId}-1,Asha Again`, `T${runId}-2,New Teacher`].join("\n"),
    });
    expect(second.state).toMatchObject({ okRows: 1, errorRows: 1 });
  });
});
