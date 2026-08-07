import { describe, expect, it } from "vitest";
import { STATE_CHANGING_METHODS } from "@vidya/platform";
import { reportingModuleDefinition, reportParamsSchema } from "./definition";

describe("reporting module definition (contract conformance)", () => {
  it("declares its table-ownership prefix", () => {
    expect(reportingModuleDefinition.tablePrefix).toBe("rpt_");
    expect(reportingModuleDefinition.name).toBe("reporting");
  });

  it("versions every route under /api/v1/reports and keeps them all authenticated", () => {
    for (const route of reportingModuleDefinition.routes) {
      expect(route.path).toMatch(/^\/api\/v1\/reports/);
      expect(route.auth.public, route.id).toBe(false);
    }
  });

  it("audits every state-changing route", () => {
    const stateChanging = reportingModuleDefinition.routes.filter((route) =>
      STATE_CHANGING_METHODS.has(route.method),
    );
    // reporting.request (the queued flow) and reporting.class-credentials
    // (#11 B4's synchronous credential sheet) — both must declare an audit action.
    expect(stateChanging.map((route) => route.id).sort()).toEqual([
      "reporting.class-credentials",
      "reporting.request",
    ]);
    for (const route of stateChanging) {
      expect(route.audit).toBeDefined();
    }
  });

  it("declares the generation job", () => {
    expect(reportingModuleDefinition.jobs.map((job) => job.name)).toEqual(["report-generate"]);
  });
});

describe("reportParamsSchema", () => {
  it("accepts each report kind's shape", () => {
    expect(reportParamsSchema.safeParse({ kind: "student-performance", studentId: "s" }).success).toBe(true);
    expect(reportParamsSchema.safeParse({ kind: "section-attendance", sectionId: "sec" }).success).toBe(true);
    expect(reportParamsSchema.safeParse({ kind: "marks-summary", classId: "cls" }).success).toBe(true);
    expect(reportParamsSchema.safeParse({ kind: "at-risk", level: "department", nodeId: "dep" }).success).toBe(true);
  });

  it("rejects wrong shapes and unknown kinds", () => {
    expect(reportParamsSchema.safeParse({ kind: "student-performance", sectionId: "s" }).success).toBe(false);
    expect(reportParamsSchema.safeParse({ kind: "at-risk", level: "planet", nodeId: "x" }).success).toBe(false);
    expect(reportParamsSchema.safeParse({ kind: "nope" }).success).toBe(false);
  });
});
