import { describe, expect, it } from "vitest";
import { STATE_CHANGING_METHODS } from "@vidya/platform";
import { reportingModuleDefinition, reportParamsSchema } from "./definition";

describe("reporting module definition (contract conformance)", () => {
  it("declares its table-ownership prefix", () => {
    expect(reportingModuleDefinition.tablePrefix).toBe("rpt_");
    expect(reportingModuleDefinition.name).toBe("reporting");
  });

  it("versions every route under its declared families and keeps them all authenticated", () => {
    // Reporting serves queued exports, permanent school documents, and
    // administrator document-format policy. Other prefixes belong elsewhere.
    for (const route of reportingModuleDefinition.routes) {
      expect(route.path, route.id).toMatch(/^\/api\/v1\/(reports|school\/(report-cards|certificates|document-formats))/);
      expect(route.auth.public, route.id).toBe(false);
    }
  });

  it("audits every state-changing route", () => {
    const stateChanging = reportingModuleDefinition.routes.filter((route) =>
      STATE_CHANGING_METHODS.has(route.method),
    );
    expect(stateChanging.map((route) => route.id).sort()).toEqual([
      "reporting.class-credentials",
      "reporting.request",
      "reporting.school-certificate-issue",
      "reporting.school-document-format-save",
      "reporting.school-report-card-generate",
      "reporting.school-report-card-preview",
      "reporting.school-report-card-publish",
      "reporting.school-report-card-withdraw",
    ]);
    // Constitution rule 7, enforced at bind time by defineRoute: a POST is a
    // write by convention and must be auditable. The report-card preview
    // persists nothing, but it still discloses a pupil's entire academic
    // standing, so auditing it is correct rather than merely compliant.
    for (const route of stateChanging) {
      expect(route.audit, route.id).toBeDefined();
    }
  });

  it("audits the report-card download, because issuing the document is a disclosure", () => {
    const download = reportingModuleDefinition.routes.find(
      (route) => route.id === "reporting.school-report-card-download",
    );
    // A GET, so the state-changing rule above does not reach it — but a
    // report card leaving the building is exactly what ADR-0020 audits.
    expect(download?.audit?.action).toBe("reporting.school-report-card-downloaded");
  });

  it("declares the generation job", () => {
    expect(reportingModuleDefinition.jobs.map((job) => job.name)).toEqual(["report-generate"]);
  });
});

describe("reportParamsSchema", () => {
  it("accepts each report kind's shape", () => {
    expect(reportParamsSchema.safeParse({ kind: "student-performance", studentId: "s" }).success).toBe(true);
    expect(reportParamsSchema.safeParse({ kind: "section-attendance", sectionId: "sec" }).success).toBe(true);
    expect(reportParamsSchema.safeParse({ kind: "teacher-attendance", collegeId: "col_1", date: "2026-09-25" }).success).toBe(true);
    expect(reportParamsSchema.safeParse({ kind: "teacher-attendance", collegeId: "col_1", date: "2026-02-30" }).success).toBe(false);
    expect(reportParamsSchema.safeParse({ kind: "marks-summary", classId: "cls" }).success).toBe(true);
    expect(reportParamsSchema.safeParse({ kind: "at-risk", level: "department", nodeId: "dep" }).success).toBe(true);
  });

  it("rejects wrong shapes and unknown kinds", () => {
    expect(reportParamsSchema.safeParse({ kind: "student-performance", sectionId: "s" }).success).toBe(false);
    expect(reportParamsSchema.safeParse({ kind: "at-risk", level: "planet", nodeId: "x" }).success).toBe(false);
    expect(reportParamsSchema.safeParse({ kind: "nope" }).success).toBe(false);
  });
});
