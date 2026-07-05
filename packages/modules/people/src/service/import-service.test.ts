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

async function makeHarness() {
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
