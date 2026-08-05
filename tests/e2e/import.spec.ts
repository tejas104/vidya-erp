import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { YEAR, apiSession, browserLogin } from "./support/fixtures";

/**
 * ASSIGNMENT #11 TASK A5 — the bulk CSV import journey, end to end.
 *
 * This is the guard that proves Track A (#11 Tasks A1-A4: template endpoint,
 * warning tier, error-CSV download, the import screens) actually works
 * against a real running app. The import RUNS IN THE WORKER — the handler
 * only enqueues it — so without a worker process this test hangs at
 * "pending" rather than failing cleanly.
 *
 * The fixture (20 valid + 3 invalid rows) is built at runtime rather than
 * checked in as a static CSV: this suite mutates a persistent seeded
 * database across reruns, so a fixture with fixed admission numbers would
 * fail the SECOND time this spec ran (its own "20 valid students" would
 * already exist from run 1 and legitimately reject as duplicates). A
 * run-unique admission-number prefix keeps every execution independent —
 * the same trick fast-path.spec.ts uses for its attendance slot (RUN_SLOT).
 */

const runId = randomUUID().slice(0, 8);

interface TreeSection {
  id: string;
  name: string;
}
interface TreeClass {
  code: string;
  sections: TreeSection[];
}
interface TreeDept {
  code: string;
  classes: TreeClass[];
}
interface Tree {
  departments: TreeDept[];
}

interface ImportTarget {
  collegeId: string;
  sectionId: string;
  departmentCode: string;
  classCode: string;
  sectionName: string;
}

/** Same college/department/class selection fixtures.ts's discover() uses
 *  (CSE -> FYCS -> first section), plus the CODES the CSV needs — discover()
 *  only returns ids, not codes, so this resolves them directly off the tree. */
async function importTarget(admin: APIRequestContext): Promise<ImportTarget> {
  const collegesRes = await admin.get("/api/v1/people/colleges");
  expect(collegesRes.ok(), "list colleges").toBeTruthy();
  const { colleges } = (await collegesRes.json()) as { colleges: { id: string; code: string }[] };
  const collegeId = (colleges.find((c) => c.code === "DEMO") ?? colleges[0]!).id;

  const treeRes = await admin.get(`/api/v1/people/colleges/${encodeURIComponent(collegeId)}/tree`);
  expect(treeRes.ok(), "college tree").toBeTruthy();
  const tree = (await treeRes.json()) as Tree;
  const dept = tree.departments.find((d) => d.code === "CSE") ?? tree.departments[0]!;
  const klass = dept.classes.find((c) => c.code === "FYCS") ?? dept.classes[0]!;
  const section = klass.sections[0]!;
  return { collegeId, sectionId: section.id, departmentCode: dept.code, classCode: klass.code, sectionName: section.name };
}

async function rosterCount(admin: APIRequestContext, sectionId: string): Promise<number> {
  const res = await admin.get(`/api/v1/people/sections/${encodeURIComponent(sectionId)}/roster`);
  expect(res.ok(), "roster").toBeTruthy();
  const { students } = (await res.json()) as { students: unknown[] };
  return students.length;
}

interface ImportState {
  status: "pending" | "running" | "completed" | "failed";
  totalRows: number;
  okRows: number;
  errorRows: number;
  warningRows: number;
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
}

/** Poll an import until the worker finishes it. If the worker isn't running
 *  the job stays "pending" forever — this throws instead of hanging the
 *  suite, naming the likely cause. */
async function pollImport(admin: APIRequestContext, importId: string, timeoutMs = 30_000): Promise<ImportState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await admin.get(`/api/v1/people/imports/${encodeURIComponent(importId)}`);
    expect(res.ok(), "get import").toBeTruthy();
    const state = (await res.json()) as ImportState;
    if (state.status === "completed" || state.status === "failed") return state;
    if (Date.now() > deadline) {
      throw new Error(`import ${importId} stuck at "${state.status}" after ${timeoutMs}ms — is the worker running?`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * 23 rows: 20 valid (enrolled into the target section) + exactly 3 invalid —
 * a blank admission_no (schema failure), a duplicate admission_no within the
 * file, and an enrollment trio pointing at a section that doesn't exist. A
 * fourth kind of "invalid" row — a fully-blank enrollment trio — is
 * deliberately NOT included: that's the warning tier (student created
 * unassigned), not an error, and mixing it in would make "exactly 3 errors"
 * wrong by construction.
 */
function buildFixture(target: ImportTarget): { csv: string; validAdmissionNos: string[] } {
  const header = "admission_no,full_name,department_code,class_code,section_name";
  const validAdmissionNos = Array.from({ length: 20 }, (_, i) => `E2E-IMP-${runId}-${String(i + 1).padStart(2, "0")}`);
  const validRows = validAdmissionNos.map(
    (no, i) => `${no},E2E Import Student ${i + 1},${target.departmentCode},${target.classCode},${target.sectionName}`,
  );
  const invalidRows = [
    // (1) missing admission_no — fails the row schema (min length 1).
    `,E2E Missing Admission Number,${target.departmentCode},${target.classCode},${target.sectionName}`,
    // (2) duplicate of a valid row's admission_no, later in the file — the
    // first occurrence (above) stays valid, this one is the error.
    `${validAdmissionNos[0]},E2E Duplicate In File,${target.departmentCode},${target.classCode},${target.sectionName}`,
    // (3) full enrollment trio, but the section name doesn't exist.
    `E2E-IMP-${runId}-BADSEC,E2E Bad Section,${target.departmentCode},${target.classCode},NoSuchSection-${runId}`,
  ];
  return { csv: [header, ...validRows, ...invalidRows].join("\n"), validAdmissionNos };
}

test.describe("bulk CSV import journey (assignment #11 task A5)", () => {
  test("upload, dry-run preview, confirm, idempotent re-upload, rejected-rows download", async ({ page, baseURL }) => {
    const admin = await apiSession(baseURL!, "admin");
    const target = await importTarget(admin);
    const { csv, validAdmissionNos } = buildFixture(target);
    expect(csv.split("\n"), "header + 23 data rows").toHaveLength(24);

    // Derived from the live seed, not guessed — the section may already
    // carry demo-seeded students.
    const before = await rosterCount(admin, target.sectionId);

    // --- upload + dry-run through the real /manage/import/students screen ---
    await browserLogin(page, "admin");
    await page.goto("/manage/import/students");
    await expect(page.getByRole("heading", { level: 1, name: /import students/i })).toBeVisible();

    const yearInput = page.locator("#imp-students-year");
    await expect(yearInput).toHaveValue(YEAR);

    await page.setInputFiles('input[type="file"]', {
      name: `import-${runId}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await expect(page.locator("#imp-students-csv")).toHaveValue(csv);

    const [dryRunResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/v1/people/imports") && r.request().method() === "POST"),
      page.getByRole("button", { name: /preview \(dry-run\)/i }).click(),
    ]);
    expect(dryRunResponse.status(), "dry-run enqueue").toBe(202);
    const { importId: dryRunImportId } = (await dryRunResponse.json()) as { importId: string };

    await expect(page.getByTestId("import-preview"), "preview panel renders").toBeVisible({ timeout: 15_000 });
    const dryRunState = await pollImport(admin, dryRunImportId);
    expect(dryRunState, "dry-run flags exactly 3 rows as errors, nothing written").toMatchObject({
      status: "completed",
      totalRows: 23,
      okRows: 20,
      warningRows: 0,
      errorRows: 3,
    });
    expect(await rosterCount(admin, target.sectionId), "dry-run writes nothing").toBe(before);

    // --- confirm the same run through the screen ---
    const [confirmResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/v1/people/imports") && r.request().method() === "POST"),
      page.getByRole("button", { name: /confirm & import/i }).click(),
    ]);
    expect(confirmResponse.status(), "confirm enqueue").toBe(202);
    const { importId: confirmImportId } = (await confirmResponse.json()) as { importId: string };

    await expect(page.getByTestId("import-final"), "result panel renders").toBeVisible({ timeout: 15_000 });
    const confirmState = await pollImport(admin, confirmImportId);
    expect(confirmState, "confirmed run matches the preview").toMatchObject({
      status: "completed",
      totalRows: 23,
      okRows: 20,
      warningRows: 0,
      errorRows: 3,
    });

    // --- the 20 valid students now exist: derived from the seed, not hardcoded ---
    const after = await rosterCount(admin, target.sectionId);
    expect(after, "roster grew by exactly the 20 valid rows").toBe(before + 20);

    // --- idempotency: re-uploading the SAME file adds ZERO students. This is
    // the single most valuable assertion in this journey — existing
    // admission numbers must come back as row-level errors, never silently
    // update the existing record. ---
    const reImportRes = await admin.post("/api/v1/people/imports", {
      data: { kind: "students", collegeId: target.collegeId, academicYear: YEAR, dryRun: false, csv },
    });
    expect(reImportRes.status(), "re-upload enqueue").toBe(202);
    const { importId: reImportId } = (await reImportRes.json()) as { importId: string };
    const reImportState = await pollImport(admin, reImportId);
    expect(reImportState.okRows, "re-upload creates no new students").toBe(0);
    expect(reImportState.errorRows, "every row rejected the second time").toBe(23);

    const alreadyExists = reImportState.errors.filter((e) => /already exists/i.test(e.message));
    expect(alreadyExists, "all 20 previously-created admission numbers rejected").toHaveLength(20);
    for (const no of validAdmissionNos) {
      expect(
        alreadyExists.some((e) => e.message.includes(no)),
        `admission_no ${no} comes back as a row error, not a silent update`,
      ).toBe(true);
    }

    expect(await rosterCount(admin, target.sectionId), "re-upload creates no new enrollments either").toBe(after);

    // --- rejected-rows CSV, downloaded from the CONFIRMED import (3 rows) ---
    const errorsRes = await admin.get(`/api/v1/people/imports/${encodeURIComponent(confirmImportId)}/errors`);
    expect(errorsRes.ok(), "errors csv").toBeTruthy();
    expect(errorsRes.headers()["content-type"] ?? "").toContain("text/csv");
    const errorsCsv = (await errorsRes.text()).trim();
    const lines = errorsCsv.split("\r\n").filter((line) => line.length > 0);
    expect(lines[0], "header row").toBe("row,reason");
    expect(lines.length - 1, "3 rejected data rows").toBe(3);

    await admin.dispose();
  });
});
