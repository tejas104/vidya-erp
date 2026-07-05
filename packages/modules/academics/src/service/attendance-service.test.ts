import { describe, expect, it } from "vitest";
import { pino } from "pino";
import {
  AttendanceService,
  InvalidEntriesError,
  UnknownSectionError,
} from "./attendance-service";
import { DuplicateSessionError } from "../repo/attendance-repo";
import {
  FakePeopleDirectory,
  InMemoryAttendanceRepo,
  ORG,
  RecordingAudit,
} from "../../test-support/fakes";

const log = pino({ level: "silent" });

function makeService() {
  const repo = new InMemoryAttendanceRepo();
  const audit = new RecordingAudit();
  const gaps: number[] = [];
  const service = new AttendanceService({
    repo,
    directory: new FakePeopleDirectory(),
    audit,
    onGaps: (count) => gaps.push(count),
  });
  return { service, repo, audit, gaps };
}

const baseSession = {
  sectionId: ORG.sectionA,
  heldOn: "2026-07-06",
  slot: "day",
  academicYear: "2026-27",
  takenBy: "ct-1",
  entries: [
    { studentId: ORG.studentA1, status: "present" as const },
    { studentId: ORG.studentA2, status: "absent" as const },
  ],
};

describe("recordSession", () => {
  it("stamps the section's full org path onto the session", async () => {
    const { service } = makeService();
    const { session, entries } = await service.recordSession(baseSession);
    expect(session).toMatchObject({
      collegeId: ORG.collegeId,
      departmentId: ORG.departmentId,
      classId: ORG.classId,
      sectionId: ORG.sectionA,
    });
    expect(entries).toHaveLength(2);
  });

  it("rejects unknown sections", async () => {
    const { service } = makeService();
    await expect(
      service.recordSession({ ...baseSession, sectionId: "sec_ghost" }),
    ).rejects.toThrow(UnknownSectionError);
  });

  it("rejects entries outside the live roster and duplicates, as a batch", async () => {
    const { service, repo } = makeService();
    try {
      await service.recordSession({
        ...baseSession,
        entries: [
          { studentId: ORG.studentA1, status: "present" },
          { studentId: ORG.studentA1, status: "absent" },
          { studentId: ORG.studentB1, status: "present" }, // other section
          { studentId: "stu_ghost", status: "present" },
        ],
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEntriesError);
      const invalid = (error as InvalidEntriesError).invalid;
      expect(invalid.map((row) => row.studentId).sort()).toEqual([
        ORG.studentA1,
        ORG.studentB1,
        "stu_ghost",
      ]);
    }
    expect(repo.sessions.size).toBe(0); // nothing written
  });

  it("refuses a duplicate section/date/slot", async () => {
    const { service } = makeService();
    await service.recordSession(baseSession);
    await expect(service.recordSession(baseSession)).rejects.toThrow(DuplicateSessionError);
    // A different slot on the same day is a different session.
    const second = await service.recordSession({ ...baseSession, slot: "afternoon" });
    expect(second.session.slot).toBe("afternoon");
  });
});

describe("corrections and reads", () => {
  it("correctEntry returns the previous status; null for unknown entries", async () => {
    const { service } = makeService();
    const { session } = await service.recordSession(baseSession);
    const result = await service.correctEntry(session.id, ORG.studentA2, "late");
    expect(result).toEqual({ before: "absent" });
    expect(await service.correctEntry(session.id, "stu_ghost", "present")).toBeNull();
    expect(await service.correctEntry("ses_ghost", ORG.studentA1, "present")).toBeNull();
  });

  it("lists a section's sessions within a range and a student's sessions", async () => {
    const { service } = makeService();
    await service.recordSession(baseSession);
    await service.recordSession({ ...baseSession, heldOn: "2026-07-07" });
    const listed = await service.listSessions(ORG.sectionA, { from: "2026-07-07", limit: 50 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.session.heldOn).toBe("2026-07-07");

    const studentRows = await service.sessionsForStudent(ORG.studentA1, "2026-27");
    expect(studentRows).toHaveLength(2);
    expect(await service.sessionsForStudent(ORG.studentA1, "2025-26")).toHaveLength(0);
  });
});

describe("gapScan", () => {
  it("reports sections without a session, audits, and feeds the metric", async () => {
    const { service, audit, gaps } = makeService();
    await service.recordSession(baseSession); // covers section A only
    const result = await service.gapScan("2026-07-06", log);
    expect(result).toEqual({ activeSections: 2, missing: [ORG.sectionB] });
    expect(audit.actions()).toEqual(["academics.attendance-gap-detected"]);
    expect(audit.events[0]?.details).toMatchObject({ missingCount: 1 });
    expect(gaps).toEqual([1]);
  });

  it("stays silent when every active section is covered", async () => {
    const { service, audit, gaps } = makeService();
    await service.recordSession(baseSession);
    await service.recordSession({
      ...baseSession,
      sectionId: ORG.sectionB,
      entries: [{ studentId: ORG.studentB1, status: "present" }],
    });
    const result = await service.gapScan("2026-07-06", log);
    expect(result.missing).toEqual([]);
    expect(audit.events).toHaveLength(0);
    expect(gaps).toEqual([]);
  });
});
