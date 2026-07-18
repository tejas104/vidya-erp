import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type {
  Principal,
  RouteContext,
  ScopeChecker,
  ScopeDecision,
} from "@vidya/platform";
import { createAcademicsHandlers, type AuditHistoryEntry } from "./handlers";
import { AttendanceService } from "../service/attendance-service";
import { MarksService } from "../service/marks-service";
import {
  FakePeopleDirectory,
  InMemoryAttendanceRepo,
  InMemoryMarksRepo,
  ORG,
  RecordingAudit,
} from "../../test-support/fakes";

const logger = pino({ level: "silent" });

/** TEST DOUBLE — scriptable per-resource decisions; the real matrix is exercised in scope-traces.test.ts. */
class StubScopeChecker implements ScopeChecker {
  decide: (resource: { org: { sectionId?: string }; subjectId?: string }) => boolean = () => true;
  readonly calls: { action: string; resource: unknown }[] = [];
  check(_principal: Principal, action: string, resource: unknown): ScopeDecision {
    this.calls.push({ action, resource });
    return this.decide(resource as { org: { sectionId?: string }; subjectId?: string })
      ? { granted: true, reason: "stub-allow" }
      : { granted: false, reason: "stub-deny" };
  }
}

function makeHarness(
  historyRows: Partial<Record<string, AuditHistoryEntry[]>> = {},
  actionEvents: Partial<Record<string, AuditHistoryEntry[]>> = {},
) {
  const attendanceRepo = new InMemoryAttendanceRepo();
  const marksRepo = new InMemoryMarksRepo();
  const scopeChecker = new StubScopeChecker();
  const directory = new FakePeopleDirectory();
  const audit = new RecordingAudit();
  const attendance = new AttendanceService({ repo: attendanceRepo, directory, audit });
  const marks = new MarksService({ repo: marksRepo, directory });
  const handlers = createAcademicsHandlers({
    attendance,
    marks,
    scopeChecker,
    peopleDirectory: directory,
    readAudit: async (resourceType) => historyRows[resourceType] ?? [],
    readAuditByAction: async (action) => actionEvents[action] ?? [],
  });
  return { handlers, attendanceRepo, marksRepo, scopeChecker, attendance, marks, directory };
}

const teacher: Principal = {
  id: "t-math",
  kind: "user",
  displayName: "Math Teacher",
  roles: ["teacher"],
  scopes: [],
  grants: [],
  sessionId: "s",
};

function ctx(input: { body?: unknown; params?: unknown; query?: unknown } = {}): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal: teacher,
    request: {
      params: input.params,
      query: input.query,
      body: input.body,
      headers: new Headers(),
    },
  };
}

const sessionBody = {
  sectionId: ORG.sectionA,
  heldOn: "2026-07-06",
  slot: "day",
  academicYear: "2026-27",
  entries: [
    { studentId: ORG.studentA1, status: "present" },
    { studentId: ORG.studentA2, status: "absent" },
  ],
};

async function seedAssessment(harness: ReturnType<typeof makeHarness>) {
  const created = await harness.handlers["academics.assessment-create"]!(
    ctx({
      body: {
        classId: ORG.classId,
        subjectId: ORG.mathId,
        kind: "exam",
        name: "Midterm",
        academicYear: "2026-27",
        maxScore: 100,
      },
    }),
  );
  expect(created.status).toBe(201);
  return (created.body as { id: string }).id;
}

describe("attendance handlers", () => {
  it("records a session (201), audits counts, and denies before writing on scope-deny", async () => {
    const harness = makeHarness();
    const created = await harness.handlers["academics.attendance-record"]!(ctx({ body: sessionBody }));
    expect(created.status).toBe(201);
    expect(created.audit?.details).toMatchObject({
      counts: { present: 1, absent: 1, late: 0, excused: 0 },
    });

    harness.scopeChecker.decide = () => false;
    const denied = await harness.handlers["academics.attendance-record"]!(
      ctx({ body: { ...sessionBody, heldOn: "2026-07-07" } }),
    );
    expect(denied.status).toBe(403);
    expect(harness.attendanceRepo.sessions.size).toBe(1);
  });

  it("maps unknown section 404, duplicate 409, roster violations 422", async () => {
    const harness = makeHarness();
    expect(
      (
        await harness.handlers["academics.attendance-record"]!(
          ctx({ body: { ...sessionBody, sectionId: "sec_ghost" } }),
        )
      ).status,
    ).toBe(404);
    await harness.handlers["academics.attendance-record"]!(ctx({ body: sessionBody }));
    expect(
      (await harness.handlers["academics.attendance-record"]!(ctx({ body: sessionBody }))).status,
    ).toBe(409);
    const invalid = await harness.handlers["academics.attendance-record"]!(
      ctx({
        body: {
          ...sessionBody,
          heldOn: "2026-07-08",
          entries: [{ studentId: ORG.studentB1, status: "present" }],
        },
      }),
    );
    expect(invalid.status).toBe(422);
    expect((invalid.body as { invalid: unknown[] }).invalid).toHaveLength(1);
  });

  it("corrects an entry with a before/after audit; 404s unknown entries", async () => {
    const harness = makeHarness();
    const created = await harness.handlers["academics.attendance-record"]!(ctx({ body: sessionBody }));
    const sessionId = (created.body as { id: string }).id;
    const corrected = await harness.handlers["academics.attendance-correct"]!(
      ctx({ params: { sessionId, studentId: ORG.studentA2 }, body: { status: "late" } }),
    );
    expect(corrected.status).toBe(200);
    expect(corrected.audit?.details).toMatchObject({ before: "absent", after: "late" });
    expect(
      (
        await harness.handlers["academics.attendance-correct"]!(
          ctx({ params: { sessionId, studentId: "stu_ghost" }, body: { status: "late" } }),
        )
      ).status,
    ).toBe(404);
  });

  it("session-get and section listings run through the checker", async () => {
    const harness = makeHarness();
    const created = await harness.handlers["academics.attendance-record"]!(ctx({ body: sessionBody }));
    const sessionId = (created.body as { id: string }).id;
    const read = await harness.handlers["academics.attendance-session-get"]!(
      ctx({ params: { sessionId } }),
    );
    expect(read.status).toBe(200);
    const listing = await harness.handlers["academics.section-attendance"]!(
      ctx({ params: { sectionId: ORG.sectionA }, query: { limit: 50 } }),
    );
    expect(listing.status).toBe(200);
    expect((listing.body as { sessions: unknown[] }).sessions).toHaveLength(1);
    harness.scopeChecker.decide = () => false;
    expect(
      (await harness.handlers["academics.attendance-session-get"]!(ctx({ params: { sessionId } })))
        .status,
    ).toBe(403);
  });

  it("student attendance is row-filtered by each session's OWN path", async () => {
    const harness = makeHarness();
    // Student A1 attends in section A; also seed a session in section B for B1.
    await harness.handlers["academics.attendance-record"]!(ctx({ body: sessionBody }));
    await harness.handlers["academics.attendance-record"]!(
      ctx({
        body: {
          ...sessionBody,
          sectionId: ORG.sectionB,
          entries: [{ studentId: ORG.studentB1, status: "present" }],
        },
      }),
    );
    // Scope: only section A is visible to this caller.
    harness.scopeChecker.decide = (resource) => resource.org.sectionId === ORG.sectionA;
    const a1 = await harness.handlers["academics.student-attendance"]!(
      ctx({ params: { studentId: ORG.studentA1 }, query: {} }),
    );
    expect((a1.body as { counts: { present: number } }).counts.present).toBe(1);
    const b1 = await harness.handlers["academics.student-attendance"]!(
      ctx({ params: { studentId: ORG.studentB1 }, query: {} }),
    );
    expect((b1.body as { sessions: unknown[] }).sessions).toHaveLength(0);
    expect(
      (
        await harness.handlers["academics.student-attendance"]!(
          ctx({ params: { studentId: "stu_ghost" }, query: {} }),
        )
      ).status,
    ).toBe(404);
  });

  it("section-corrections keeps only this section's events, resolves names, newest first; 403/404 hold", async () => {
    const actionEvents: Partial<Record<string, AuditHistoryEntry[]>> = {};
    const harness = makeHarness({}, actionEvents);
    const inA = await harness.handlers["academics.attendance-record"]!(ctx({ body: sessionBody }));
    const sessionA = (inA.body as { id: string }).id;
    const inB = await harness.handlers["academics.attendance-record"]!(
      ctx({
        body: {
          ...sessionBody,
          sectionId: ORG.sectionB,
          entries: [{ studentId: ORG.studentB1, status: "present" }],
        },
      }),
    );
    const sessionB = (inB.body as { id: string }).id;

    // College-wide feed: one correction in section A (older), one in B (newer),
    // and one dangling (unknown session) that must be dropped, not crash.
    actionEvents["academics.attendance-corrected"] = [
      {
        action: "academics.attendance-corrected",
        actorId: "t-math",
        occurredAt: new Date("2026-07-06T09:00:00Z"),
        details: { sessionId: sessionA, studentId: ORG.studentA1, before: "absent", after: "late" },
      },
      {
        action: "academics.attendance-corrected",
        actorId: null,
        occurredAt: new Date("2026-07-06T10:00:00Z"),
        details: { sessionId: sessionB, studentId: ORG.studentB1, before: "present", after: "absent" },
      },
      {
        action: "academics.attendance-corrected",
        actorId: "t-math",
        occurredAt: new Date("2026-07-06T11:00:00Z"),
        details: { sessionId: "ses_ghost", studentId: ORG.studentA1, before: "present", after: "late" },
      },
    ];

    const served = await harness.handlers["academics.section-corrections"]!(
      ctx({ params: { sectionId: ORG.sectionA }, query: { limit: 50 } }),
    );
    expect(served.status).toBe(200);
    const body = served.body as {
      corrections: {
        sessionId: string;
        studentId: string;
        studentName: string;
        before: string;
        after: string;
        byName?: string;
      }[];
    };
    // FakePeopleDirectory.teacherByIdentityUser always returns null, so the
    // actor name is genuinely unresolvable here — byName is correctly omitted.
    expect(body.corrections).toEqual([
      {
        sessionId: sessionA,
        studentId: ORG.studentA1,
        studentName: "Meera Nair",
        before: "absent",
        after: "late",
        at: "2026-07-06T09:00:00.000Z",
      },
    ]);

    // Once the actor's identity id resolves to a teacher, byName appears.
    harness.directory.teacherByIdentityUser = async (identityUserId) =>
      identityUserId === "t-math"
        ? { teacherId: "tch_math", collegeId: ORG.collegeId, fullName: "Math Teacher" }
        : null;
    const withActor = await harness.handlers["academics.section-corrections"]!(
      ctx({ params: { sectionId: ORG.sectionA }, query: { limit: 50 } }),
    );
    expect((withActor.body as typeof body).corrections[0]?.byName).toBe("Math Teacher");

    harness.scopeChecker.decide = () => false;
    expect(
      (
        await harness.handlers["academics.section-corrections"]!(
          ctx({ params: { sectionId: ORG.sectionA }, query: { limit: 50 } }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await harness.handlers["academics.section-corrections"]!(
          ctx({ params: { sectionId: "sec_ghost" }, query: { limit: 50 } }),
        )
      ).status,
    ).toBe(404);
  });
});

describe("marks handlers", () => {
  it("creates assessments (404 unknown class, 422 cross-department, 409 duplicate)", async () => {
    const harness = makeHarness();
    await seedAssessment(harness);
    expect(
      (
        await harness.handlers["academics.assessment-create"]!(
          ctx({
            body: {
              classId: "cls_ghost",
              subjectId: ORG.mathId,
              kind: "exam",
              name: "X",
              academicYear: "2026-27",
              maxScore: 10,
            },
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await harness.handlers["academics.assessment-create"]!(
          ctx({
            body: {
              classId: ORG.classId,
              subjectId: ORG.mathId,
              kind: "exam",
              name: "Midterm",
              academicYear: "2026-27",
              maxScore: 100,
            },
          }),
        )
      ).status,
    ).toBe(409);
  });

  it("enters a marksheet with diff audit; 422 on invalid entries; deletion blocked by marks", async () => {
    const harness = makeHarness();
    const assessmentId = await seedAssessment(harness);
    const entered = await harness.handlers["academics.marks-enter"]!(
      ctx({
        params: { assessmentId },
        body: {
          entries: [
            { studentId: ORG.studentA1, score: 72 },
            { studentId: ORG.studentA2, score: 45 },
          ],
        },
      }),
    );
    expect(entered.status).toBe(200);
    expect(entered.body).toEqual({ created: 2, updated: 0, unchanged: 0 });
    expect(
      (entered.audit?.details as { changes: unknown[] }).changes,
    ).toHaveLength(2);

    const invalid = await harness.handlers["academics.marks-enter"]!(
      ctx({
        params: { assessmentId },
        body: { entries: [{ studentId: ORG.studentA1, score: 999 }] },
      }),
    );
    expect(invalid.status).toBe(422);

    expect(
      (
        await harness.handlers["academics.assessment-delete"]!(
          ctx({ params: { assessmentId } }),
        )
      ).status,
    ).toBe(409);
  });

  it("corrects a mark (audited before/after, 422 over max) and serves history", async () => {
    const harness = makeHarness({
      mark: [
        {
          action: "academics.mark-corrected",
          actorId: "t-math",
          occurredAt: new Date("2026-07-06T10:00:00Z"),
          details: { before: 72, after: 80 },
        },
      ],
      assessment: [
        {
          action: "academics.marks-entered",
          actorId: "t-math",
          occurredAt: new Date("2026-07-05T10:00:00Z"),
          details: { changes: [] },
        },
        {
          action: "academics.assessment-created",
          actorId: "t-math",
          occurredAt: new Date("2026-07-04T10:00:00Z"),
          details: {},
        },
      ],
    });
    const assessmentId = await seedAssessment(harness);
    await harness.handlers["academics.marks-enter"]!(
      ctx({ params: { assessmentId }, body: { entries: [{ studentId: ORG.studentA1, score: 72 }] } }),
    );
    const markId = [...harness.marksRepo.marks.keys()][0]!;

    const corrected = await harness.handlers["academics.mark-correct"]!(
      ctx({ params: { markId }, body: { score: 80 } }),
    );
    expect(corrected.status).toBe(200);
    expect(corrected.audit?.details).toMatchObject({ before: 72, after: 80 });
    expect(
      (
        await harness.handlers["academics.mark-correct"]!(
          ctx({ params: { markId }, body: { score: 150 } }),
        )
      ).status,
    ).toBe(422);

    const served = await harness.handlers["academics.mark-history"]!(ctx({ params: { markId } }));
    expect(served.status).toBe(200);
    const body = served.body as { history: { action: string }[] };
    // Only mark-relevant actions, newest first; assessment-created filtered out.
    expect(body.history.map((event) => event.action)).toEqual([
      "academics.mark-corrected",
      "academics.marks-entered",
    ]);
  });

  it("row-filters class assessments and student marks by subject scope", async () => {
    const harness = makeHarness();
    await seedAssessment(harness);
    const physics = await harness.handlers["academics.assessment-create"]!(
      ctx({
        body: {
          classId: ORG.classId,
          subjectId: ORG.physicsId,
          kind: "quiz",
          name: "Physics Quiz",
          academicYear: "2026-27",
          maxScore: 20,
        },
      }),
    );
    const physicsId = (physics.body as { id: string }).id;
    await harness.handlers["academics.marks-enter"]!(
      ctx({ params: { assessmentId: physicsId }, body: { entries: [{ studentId: ORG.studentA1, score: 15 }] } }),
    );

    // Scope: caller may only see math.
    harness.scopeChecker.decide = (resource) =>
      resource.subjectId === undefined || resource.subjectId === ORG.mathId;

    const listing = await harness.handlers["academics.class-assessments"]!(
      ctx({ params: { classId: ORG.classId }, query: {} }),
    );
    const assessments = (listing.body as { assessments: { subjectId: string }[] }).assessments;
    expect(assessments.map((row) => row.subjectId)).toEqual([ORG.mathId]);

    const studentMarks = await harness.handlers["academics.student-marks"]!(
      ctx({ params: { studentId: ORG.studentA1 }, query: {} }),
    );
    expect((studentMarks.body as { marks: unknown[] }).marks).toHaveLength(0); // physics-only marks hidden
    expect(
      (
        await harness.handlers["academics.student-marks"]!(
          ctx({ params: { studentId: "stu_ghost" }, query: {} }),
        )
      ).status,
    ).toBe(404);
  });

  it("assessment reads honor the checker", async () => {
    const harness = makeHarness();
    const assessmentId = await seedAssessment(harness);
    expect(
      (await harness.handlers["academics.assessment-get"]!(ctx({ params: { assessmentId } }))).status,
    ).toBe(200);
    expect(
      (await harness.handlers["academics.assessment-marks"]!(ctx({ params: { assessmentId } }))).status,
    ).toBe(200);
    harness.scopeChecker.decide = () => false;
    expect(
      (await harness.handlers["academics.assessment-get"]!(ctx({ params: { assessmentId } }))).status,
    ).toBe(403);
    expect(
      (await harness.handlers["academics.assessment-marks"]!(ctx({ params: { assessmentId } }))).status,
    ).toBe(403);
  });
});

describe("chokepoint discipline", () => {
  it("every exercised handler consulted the ScopeChecker", async () => {
    const harness = makeHarness();
    await harness.handlers["academics.attendance-record"]!(ctx({ body: sessionBody }));
    const assessmentId = await seedAssessment(harness);
    await harness.handlers["academics.assessment-get"]!(ctx({ params: { assessmentId } }));
    expect(harness.scopeChecker.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of harness.scopeChecker.calls) {
      expect((call.resource as { module: string }).module).toBe("academics");
    }
  });
});
