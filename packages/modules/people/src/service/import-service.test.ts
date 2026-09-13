import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { ImportService } from "./import-service";
import { UnknownReferenceError } from "./people-service";
import {
  InMemoryImportsRepo,
  InMemoryOrgRepo,
  InMemoryPeopleRepo,
  MemoryObjectStore,
  RecordingAudit,
  seedOrg,
} from "../../test-support/fakes";

const log = pino({ level: "silent" });

async function makeHarness(edition: "college" | "school" = "college") {
  const orgRepo = new InMemoryOrgRepo();
  const people = new InMemoryPeopleRepo();
  const imports = new InMemoryImportsRepo();
  const store = new MemoryObjectStore();
  const audit = new RecordingAudit();
  const org = await seedOrg(orgRepo);
  const finished: string[] = [];
  const service = new ImportService({
    imports,
    people,
    orgRepo,
    store,
    audit,
    edition,
    onFinished: (kind, status) => finished.push(`${kind}:${status}`),
  });
  return { service, orgRepo, people, imports, store, audit, org, finished };
}

const studentsCsv = (org: Awaited<ReturnType<typeof makeHarness>>["org"], extraRows = "") =>
  [
    "admission_no,full_name,department_code,class_code,section_name",
    `A001,Meera Nair,SCI,BSC1,A`,
    `A002,Ravi Kumar,,,`,
    extraRows,
  ]
    .filter((line) => line !== "")
    .join("\n");

describe("createImport", () => {
  it("stores the CSV and creates the bookkeeping row", async () => {
    const { service, store, org } = await makeHarness();
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv: "admission_no,full_name\nA1,X",
      dryRun: false,
      requestedBy: "admin-1",
    });
    expect(row.status).toBe("pending");
    expect(await store.getText(row.objectKey)).toContain("A1,X");
  });

  it("rejects unknown colleges", async () => {
    const { service } = await makeHarness();
    await expect(
      service.createImport({
        kind: "students",
        collegeId: "col_ghost",
        csv: "x",
        dryRun: false,
        requestedBy: "admin-1",
      }),
    ).rejects.toThrow(UnknownReferenceError);
  });
});

describe("student imports", () => {
  it("creates students (with enrollment via codes) and audits the run", async () => {
    const { service, people, imports, audit, org, finished } = await makeHarness();
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv: studentsCsv(org),
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    const state = await imports.get(row.id);
    expect(state).toMatchObject({ status: "completed", totalRows: 2, okRows: 2, errorRows: 0 });

    const meera = await people.findStudentByAdmissionNo(org.college.id, "A001");
    expect(meera?.sourceImportId).toBe(row.id);
    expect(await people.latestActiveEnrollment(meera!.id)).toMatchObject({
      sectionId: org.section.id,
      academicYear: "2026-27",
    });
    // Ravi has no enrollment columns → student only.
    const ravi = await people.findStudentByAdmissionNo(org.college.id, "A002");
    expect(await people.latestActiveEnrollment(ravi!.id)).toBeNull();

    // Import creates people, not logins (fix wave, #11 B4 post-review): a
    // freshly imported student has no identity account yet — the per-class
    // credential sheet is the only path that issues one.
    expect(meera?.identityUserId).toBeNull();
    expect(ravi?.identityUserId).toBeNull();

    expect(audit.events[0]).toMatchObject({
      action: "people.import-completed",
      actorType: "user",
      actorId: "admin-1",
      details: expect.objectContaining({ okRows: 2, dryRun: false }),
    });
    expect(finished).toEqual(["students:completed"]);
  });

  it("reports per-row errors without aborting the run", async () => {
    const { service, people, imports, org } = await makeHarness();
    await people.createStudent({ collegeId: org.college.id, admissionNo: "A010", fullName: "Existing" });
    const csv = [
      "admission_no,full_name,department_code,class_code,section_name",
      "A001,Good Row,SCI,BSC1,A",
      ",Missing Number,,,",
      "A001,Duplicate In File,,,",
      "A010,Already In Db,,,",
      "A011,Bad Trio,SCI,,",
      "A012,Unknown Section,SCI,BSC1,Z",
    ].join("\n");
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv,
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    const state = await imports.get(row.id);
    expect(state).toMatchObject({ status: "completed", totalRows: 6, okRows: 1, errorRows: 5 });
    const messages = (state?.errors as { row: number; message: string }[]).map((e) => `${e.row}:${e.message}`);
    expect(messages.some((m) => m.startsWith("3:") && m.includes("admission_no"))).toBe(true);
    expect(messages.some((m) => m.startsWith("4:") && m.includes("duplicate"))).toBe(true);
    expect(messages.some((m) => m.startsWith("5:") && m.includes("already exists"))).toBe(true);
    expect(messages.some((m) => m.startsWith("6:") && m.includes("all of"))).toBe(true);
    expect(messages.some((m) => m.startsWith("7:") && m.includes("no such section"))).toBe(true);
  });

  it("dry-run validates and counts without writing anything", async () => {
    const { service, people, imports, org } = await makeHarness();
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv: studentsCsv(org),
      dryRun: true,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    expect(await imports.get(row.id)).toMatchObject({ status: "completed", okRows: 2 });
    expect(people.students.size).toBe(0);
    expect(people.enrollments.size).toBe(0);
  });

  it("rejects enrollment columns when the import has no academicYear", async () => {
    const { service, imports, org } = await makeHarness();
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      csv: studentsCsv(org),
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    const state = await imports.get(row.id);
    expect(state?.okRows).toBe(1); // the enrollment-free row still lands
    expect(JSON.stringify(state?.errors)).toContain("no academicYear");
  });

  it("marks the import failed (and audits) when the CSV is unreadable", async () => {
    const { service, imports, store, audit, org, finished } = await makeHarness();
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      csv: "admission_no,full_name\nA1,X",
      dryRun: false,
      requestedBy: "admin-1",
    });
    store.objects.clear(); // simulate the object vanishing
    await expect(service.run(row.id, log)).rejects.toThrow(/no such object/);
    expect(await imports.get(row.id)).toMatchObject({ status: "failed" });
    expect(audit.actions()).toContain("people.import-failed");
    expect(finished).toEqual(["students:failed"]);
  });

  it("warns but still imports a student with no enrollment columns", async () => {
    const { service, people, imports, org } = await makeHarness();
    const csv = "admission_no,full_name\nA-1,Asha Rao\n";
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv,
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    const state = await imports.get(row.id);
    expect(state).toMatchObject({ okRows: 1, errorRows: 0, warningRows: 1 });
    expect(state?.warnings).toMatchObject([{ row: 2, message: expect.stringMatching(/unassigned/i) }]);
    const asha = await people.findStudentByAdmissionNo(org.college.id, "A-1");
    expect(asha).not.toBeNull();
  });

  it("keeps a duplicate admission number an ERROR, not a warning", async () => {
    const { service, people, imports, org } = await makeHarness();
    await people.createStudent({ collegeId: org.college.id, admissionNo: "A010", fullName: "Existing" });
    const csv = "admission_no,full_name\nA010,Already In Db\n";
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv,
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    const state = await imports.get(row.id);
    expect(state).toMatchObject({ errorRows: 1, warningRows: 0 });
  });

  it("skips an already-completed import (idempotent re-delivery)", async () => {
    const { service, people, org } = await makeHarness();
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv: studentsCsv(org),
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    await service.run(row.id, log);
    expect(people.students.size).toBe(2);
  });
});

describe("teacher imports", () => {
  it("creates teachers and reports duplicates", async () => {
    const { service, people, imports, org } = await makeHarness();
    await people.createTeacher({ collegeId: org.college.id, staffNo: "T900", fullName: "Existing" });
    const csv = ["staff_no,full_name", "T001,Asha Verma", "T001,Dup In File", "T900,Already There"].join("\n");
    const row = await service.createImport({
      kind: "teachers",
      collegeId: org.college.id,
      csv,
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    expect(await imports.get(row.id)).toMatchObject({ totalRows: 3, okRows: 1, errorRows: 2 });
    expect(await people.findTeacherByStaffNo(org.college.id, "T001")).not.toBeNull();
  });
});

describe("student import on the school edition (#13, ADR-0023)", () => {
  it("enrolls from standard_code + section_name, with no department column", async () => {
    const { service, imports, people, org } = await makeHarness("school");
    const csv = [
      "admission_no,full_name,standard_code,section_name",
      "S001,Aarti Deshmukh,BSC1,A",
      "S002,Nikhil Patil,,",
    ].join("\n");
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv,
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    expect(await imports.get(row.id)).toMatchObject({
      status: "completed",
      totalRows: 2,
      okRows: 2,
      errorRows: 0,
    });
    // The enrolled one landed in the seeded section; the bare one is unassigned.
    const enrolled = [...people.students.values()].find((s) => s.admissionNo === "S001");
    expect(enrolled).toBeDefined();
    expect([...people.enrollments.values()].some((e) => e.sectionId === org.section.id)).toBe(true);
  });

  it("names the school columns in the partial-enrollment error, not the college ones", async () => {
    const { service, imports, org } = await makeHarness("school");
    const csv = ["admission_no,full_name,standard_code,section_name", "S010,Half Row,BSC1,"].join("\n");
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv,
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    const state = await imports.get(row.id);
    const messages = (state?.errors as { row: number; message: string }[]).map((e) => e.message);
    expect(messages[0]).toContain("both of standard_code and section_name");
    expect(messages[0]).not.toContain("department_code");
  });

  it("rejects a college-shaped file loudly rather than importing it unassigned", async () => {
    const { service, imports, org } = await makeHarness("school");
    // section_name is common to BOTH shapes, so a college CSV on a school
    // install supplies 1 of the 2 school columns — a partial enrollment,
    // which errors. That is the wanted outcome: a mis-editioned file must not
    // quietly import every student with no section at all.
    const csv = ["admission_no,full_name,department_code,class_code,section_name", "S020,Wrong Shape,SCI,BSC1,A"].join("\n");
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv,
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    const state = await imports.get(row.id);
    expect(state).toMatchObject({ okRows: 0, errorRows: 1 });
    const messages = (state?.errors as { message: string }[]).map((e) => e.message);
    expect(messages[0]).toContain("both of standard_code and section_name");
  });

  it("college edition still requires the full trio (the regression net)", async () => {
    const { service, imports, org } = await makeHarness("college");
    const csv = ["admission_no,full_name,department_code,class_code,section_name", "C001,Trio Row,SCI,BSC1,A"].join("\n");
    const row = await service.createImport({
      kind: "students",
      collegeId: org.college.id,
      academicYear: "2026-27",
      csv,
      dryRun: false,
      requestedBy: "admin-1",
    });
    await service.run(row.id, log);
    expect(await imports.get(row.id)).toMatchObject({ okRows: 1, errorRows: 0 });
  });
});
