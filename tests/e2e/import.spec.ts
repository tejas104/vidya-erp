import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
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
 *
 * The journey continues past "students exist" into the import->sheet->login
 * path (fix wave, post-review): import only creates people, never logins —
 * the per-class credential sheet is the only path that issues one, so this
 * spec generates that sheet for the imported class and proves the just-
 * imported students actually get rows on it, then logs in as one of them.
 * That assertion is what would have caught the real bug: import auto-issued
 * a login AND linked identityUserId while throwing the plaintext away, which
 * made every freshly imported student look "already has a login" to the
 * sheet's filter — the sheet came back empty for an entire class.
 */

const runId = randomUUID().slice(0, 8);

interface TreeSection {
  id: string;
  name: string;
}
interface TreeClass {
  id: string;
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
  classId: string;
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
  return {
    collegeId,
    classId: klass.id,
    sectionId: section.id,
    departmentCode: dept.code,
    classCode: klass.code,
    sectionName: section.name,
  };
}

/**
 * The class-credentials sheet is a real PDF, never persisted anywhere, so a
 * freshly issued plaintext temporary password only ever exists in this
 * response body — parsed straight out of the PDF bytes with node:zlib alone
 * (ADR-0009: no new PDF-parsing dependency). Duplicated from
 * credentials.spec.ts rather than imported: an e2e spec talks to the app
 * over HTTP, never into another spec file's internals.
 */
function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const streamsByObjNum = new Map<number, string>();
  const pageContentRefs: number[] = [];
  const objectRe = /(\d+) 0 obj\r?\n((?:(?!endobj)[\s\S])*?)endobj/g;
  for (const m of raw.matchAll(objectRe)) {
    const objNum = Number(m[1]);
    const body = m[2]!;
    const streamMatch = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (streamMatch !== null) {
      try {
        streamsByObjNum.set(objNum, inflateSync(Buffer.from(streamMatch[1]!, "latin1")).toString("latin1"));
      } catch {
        // Non-Flate stream (e.g. an embedded font) — irrelevant to page text.
      }
    }
    if (/\/Type \/Page\b/.test(body) && !/\/Type \/Pages\b/.test(body)) {
      const contentsMatch = body.match(/\/Contents (\d+) 0 R/);
      if (contentsMatch !== null) pageContentRefs.push(Number(contentsMatch[1]));
    }
  }
  const decodeHexShowOps = (streamText: string): string => {
    const hexTokens = streamText.match(/<([0-9A-Fa-f]+)>/g) ?? [];
    let out = "";
    for (const token of hexTokens) {
      const hex = token.slice(1, -1);
      for (let i = 0; i + 1 < hex.length; i += 2) {
        out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
    }
    return out;
  };
  return pageContentRefs.map((ref) => decodeHexShowOps(streamsByObjNum.get(ref) ?? "")).join("\n");
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

    // --- import->sheet->login: the assertion that catches the real bug.
    // Import must never auto-issue a login (it did once — see the file
    // header comment) or every one of these 20 students would already carry
    // an identityUserId and the sheet below would come back with zero rows
    // for this class. ---
    const sheetRes = await admin.post(`/api/v1/reports/class-credentials/${encodeURIComponent(target.classId)}`);
    expect(sheetRes.status(), "class-credentials").toBe(200);
    expect(sheetRes.headers()["content-type"] ?? "", "pdf content-type").toContain("application/pdf");
    const sheetBytes = await sheetRes.body();
    expect(sheetBytes.subarray(0, 5).toString("latin1"), "%PDF- magic bytes").toBe("%PDF-");
    const sheetText = pdfText(sheetBytes);
    const sample = [validAdmissionNos[0]!, validAdmissionNos[9]!, validAdmissionNos[19]!];
    for (const no of sample) {
      expect(sheetText, `imported student ${no} has a row on the credential sheet`).toContain(no);
    }

    // --- the credential the sheet just printed actually logs in. ---
    const chosen = validAdmissionNos[0]!;
    const occurrences = [...sheetText.matchAll(new RegExp(chosen, "gi"))];
    expect(occurrences.length, "roll-no cell AND username cell both carry this admission number").toBeGreaterThanOrEqual(2);
    const usernameCellEnd = occurrences[occurrences.length - 1]!.index! + chosen.length;
    const temporaryPassword = sheetText.slice(usernameCellEnd, usernameCellEnd + 10);
    expect(temporaryPassword, "10-char temporary password (platform's TEMP_PASSWORD_ALPHABET)").toMatch(
      /^[A-Za-z0-9]{10}$/,
    );
    await browserLogin(page, { username: chosen.toLowerCase(), password: temporaryPassword });
    await expect(page).toHaveURL(/\/portal/);

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
