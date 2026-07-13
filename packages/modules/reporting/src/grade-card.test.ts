import { describe, expect, it } from "vitest";
import type { Principal } from "@vidya/platform";
import type { AnalyticsReadModel } from "@vidya/module-analytics";
import type { GradeCardSource } from "@vidya/module-results";
import { canProduce, collectReport } from "./report-data";
import { renderCsv } from "./render/csv";

const principal: Principal = {
  id: "u_alpha", kind: "user", displayName: "Alpha", roles: ["student"], scopes: [], grants: [], sessionId: "s",
};
const readModel = {} as AnalyticsReadModel; // grade-card never touches analytics

/** The plan's golden card: Term 1 SGPA 8.30, CGPA 8.30. */
const source: GradeCardSource = async (_principal, studentId) => {
  if (studentId === "stu_missing") return { access: "not-found" };
  if (studentId === "stu_other") return { access: "forbidden" };
  return {
    access: "ok",
    data: {
      studentId,
      studentName: "Aarav Sharma",
      admissionNo: "FYCS-001",
      className: "FY BSc Computer Science",
      terms: [
        {
          term: "Term 1", academicYear: "2026-27", publishedAt: "2026-07-13T12:00:00Z", sgpa: 8.3,
          subjects: [
            { subjectId: "sub_ds", subjectName: "Data Structures", credits: 4, pct: 78.5, grade: "B+", points: 8 },
            { subjectId: "sub_mth", subjectName: "Discrete Mathematics", credits: 3, pct: 62, grade: "B", points: 7 },
            { subjectId: "sub_dbms", subjectName: "Database Systems", credits: 3, pct: 91, grade: "A+", points: 10 },
          ],
        },
      ],
      cgpa: 8.3,
    },
  };
};

describe("grade-card reporting kind (R4)", () => {
  it("maps the source's access decision, failing closed without a source", async () => {
    const params = { kind: "grade-card" as const, studentId: "stu_a" };
    expect(await canProduce(readModel, principal, params, "2026-27", { gradeCard: source })).toBe("ok");
    expect(await canProduce(readModel, principal, { ...params, studentId: "stu_other" }, "2026-27", { gradeCard: source })).toBe("forbidden");
    expect(await canProduce(readModel, principal, { ...params, studentId: "stu_missing" }, "2026-27", { gradeCard: source })).toBe("not-found");
    expect(await canProduce(readModel, principal, params, "2026-27")).toBe("not-found");
  });

  it("collects the marksheet: golden SGPA/CGPA, per-term table, published-only note", async () => {
    const data = await collectReport(readModel, principal, { kind: "grade-card", studentId: "stu_a" }, "2026-27", "Alpha", {
      gradeCard: source,
    });
    expect(data).not.toBeNull();
    expect(data!.title).toBe("Grade card");
    expect(data!.subtitle).toBe("Aarav Sharma · FYCS-001 · FY BSc Computer Science");
    expect(data!.stats).toContainEqual({ label: "CGPA", value: "8.30" });
    expect(data!.tables).toHaveLength(1);
    expect(data!.tables[0]!.caption).toBe("Term 1 · 2026-27 — SGPA 8.30");
    expect(data!.rowCount).toBe(3);
    expect(data!.notes[0]).toMatch(/Only published terms/);

    // Snapshot-ish text content via the CSV renderer (same ReportData the PDF draws).
    const text = renderCsv(data!);
    for (const expected of ["Data Structures", "78.5%", "B+", "Database Systems", "A+", "10"]) {
      expect(text).toContain(expected);
    }
  });

  it("returns null (fail closed) when the source denies at generation time", async () => {
    const data = await collectReport(readModel, principal, { kind: "grade-card", studentId: "stu_other" }, "2026-27", "Alpha", {
      gradeCard: source,
    });
    expect(data).toBeNull();
  });
});
