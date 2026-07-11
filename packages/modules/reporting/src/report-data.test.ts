import { describe, expect, it } from "vitest";
import { canProduce, collectReport } from "./report-data";
import { renderCsv } from "./render/csv";
import { FakeAnalyticsReadModel, principal } from "../test-support/fakes";

/**
 * The report-as-disclosure-surface proof: reporting renders EXACTLY what the
 * (already scope-filtered) analytics read model returns — it adds no field
 * and hides no withheld state. A math teacher's report contains math and
 * attendance, never physics or a class overall; a below-K aggregate prints
 * the withheld state, not a number.
 */

const YEAR = "2026-27";
const caller = principal("t-math");

describe("student performance report reflects the scoped read model", () => {
  it("includes only visible subjects and prints the hidden-overall note", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = {
      state: "ok",
      studentId: "stu_1",
      name: "Ravi Kumar",
      attendance: { pct: 88, total: 40, monthly: [] },
      subjects: [{ subjectId: "sub_math", name: "Mathematics", avgPct: 72, series: [] }],
      // physics is ABSENT (filtered by scope upstream); overall hidden.
      overallPct: null,
    };
    const data = await collectReport(read, caller, { kind: "student-performance", studentId: "stu_1" }, YEAR, "Priya");
    expect(data).not.toBeNull();
    expect(data!.tables[0]!.rows.map((row) => row[0])).toEqual(["Mathematics"]);
    expect(data!.stats.find((stat) => stat.label.startsWith("Overall"))?.value).toBe("—");
    expect(data!.notes.some((note) => note.includes("Overall average is hidden"))).toBe(true);
    // The report never mentions physics.
    expect(JSON.stringify(data)).not.toContain("Physics");
  });

  it("denied / not-found student yields no report (403/404 upstream)", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = { state: "denied" };
    expect(await collectReport(read, caller, { kind: "student-performance", studentId: "s" }, YEAR, "P")).toBeNull();
    read.student = { state: "not-found" };
    expect(await collectReport(read, caller, { kind: "student-performance", studentId: "s" }, YEAR, "P")).toBeNull();
  });
});

describe("marks summary report prints the withheld-cohort state, not a number", () => {
  it("shows 'withheld' for a below-K subject and denies a foreign subject", async () => {
    const read = new FakeAnalyticsReadModel();
    read.node = {
      level: "class",
      nodeId: "cls_1",
      nodeName: "BSc Year 1",
      attendance: { state: "no-data" },
      marks: {
        bySubject: [
          { subjectId: "sub_math", name: "Mathematics", summary: { state: "ok", value: { avgPct: 70, nMarks: 40, distinctStudents: 20, monthly: [] } } },
          { subjectId: "sub_tiny", name: "Statistics", summary: { state: "insufficient-cohort", minCohort: 5 } },
        ],
        overall: { state: "denied", deniedSubjectId: "sub_phys" },
      },
    };
    const data = await collectReport(read, caller, { kind: "marks-summary", classId: "cls_1" }, YEAR, "P");
    expect(data).not.toBeNull();
    const csv = renderCsv(data!);
    expect(csv).toContain("Mathematics,70%");
    expect(csv).toContain("cohort under 5"); // withheld, not a number
    expect(data!.stats[0]!.value).toBe("—"); // overall denied
    expect(data!.notes.some((note) => note.includes("Overall class average"))).toBe(true);
  });

  it("a caller who can read no subject gets no report at all", async () => {
    const read = new FakeAnalyticsReadModel();
    read.node = {
      level: "class",
      nodeId: "cls_1",
      nodeName: "BSc Year 1",
      attendance: { state: "denied" },
      marks: { bySubject: [], overall: { state: "denied" } },
    };
    expect(await collectReport(read, caller, { kind: "marks-summary", classId: "cls_1" }, YEAR, "P")).toBeNull();
    expect(await canProduce(read, caller, { kind: "marks-summary", classId: "cls_1" }, YEAR)).toBe("forbidden");
  });
});

describe("at-risk report is field-gated by the read model", () => {
  it("renders the entries the read model returns, blanks and all", async () => {
    const read = new FakeAnalyticsReadModel();
    read.node = {
      level: "class",
      nodeId: "cls_1",
      nodeName: "BSc Year 1",
      attendance: { state: "ok", value: { pct: 80, sessions: 10, distinctStudents: 20, monthly: [] } },
      marks: { bySubject: [], overall: { state: "no-data" } },
    };
    read.risk = [
      { studentId: "stu_1", name: "Ravi", attendancePct: 60, subjectPcts: { sub_math: 30 }, overallPct: null, reasons: ["low-attendance"] },
    ];
    const data = await collectReport(read, caller, { kind: "at-risk", level: "class", nodeId: "cls_1" }, YEAR, "P");
    expect(data!.tables[0]!.rows[0]).toEqual(["Ravi", "60%", "—", "low-attendance"]);
  });
});

describe("section attendance report", () => {
  it("lists only the students whose attendance is in the caller's scope", async () => {
    const read = new FakeAnalyticsReadModel();
    read.node = {
      level: "section",
      nodeId: "sec_a",
      nodeName: "A",
      attendance: { state: "ok", value: { pct: 82, sessions: 20, distinctStudents: 15, monthly: [] } },
      marks: { bySubject: [], overall: { state: "no-data" } },
    };
    read.roster = {
      sectionId: "sec_a",
      sectionName: "A",
      rows: [{ studentId: "stu_1", name: "Ravi", pct: 55, total: 20 }],
    };
    const data = await collectReport(read, caller, { kind: "section-attendance", sectionId: "sec_a" }, YEAR, "P");
    expect(data!.tables[0]!.rows).toEqual([["Ravi", "55%", 20]]);
    expect(data!.stats[0]!.value).toContain("82%");
  });

  it("404s an unknown section", async () => {
    const read = new FakeAnalyticsReadModel();
    read.node = null;
    read.roster = null;
    expect(await canProduce(read, caller, { kind: "section-attendance", sectionId: "sec_x" }, YEAR)).toBe("not-found");
  });
});

describe("canProduce access decisions", () => {
  it("student ok/denied/not-found map through", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = { state: "ok", studentId: "s", name: "N", attendance: null, subjects: [], overallPct: null };
    expect(await canProduce(read, caller, { kind: "student-performance", studentId: "s" }, YEAR)).toBe("ok");
    read.student = { state: "denied" };
    expect(await canProduce(read, caller, { kind: "student-performance", studentId: "s" }, YEAR)).toBe("forbidden");
    read.student = { state: "not-found" };
    expect(await canProduce(read, caller, { kind: "student-performance", studentId: "s" }, YEAR)).toBe("not-found");
  });

  it("at-risk requires the node to be covered", async () => {
    const read = new FakeAnalyticsReadModel();
    read.node = {
      level: "class", nodeId: "c", nodeName: "C",
      attendance: { state: "denied" },
      marks: { bySubject: [], overall: { state: "denied" } },
    };
    expect(await canProduce(read, caller, { kind: "at-risk", level: "class", nodeId: "c" }, YEAR)).toBe("forbidden");
    read.node = null;
    expect(await canProduce(read, caller, { kind: "at-risk", level: "class", nodeId: "c" }, YEAR)).toBe("not-found");
  });
});
