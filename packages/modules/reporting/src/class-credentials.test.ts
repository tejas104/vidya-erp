import { describe, expect, it } from "vitest";
import type { AnalyticsReadModel } from "@vidya/module-analytics";
import { canProduce, collectReport, type ClassCredentialsSource } from "./report-data";
import { renderCsv } from "./render/csv";
import { principal } from "../test-support/fakes";

const readModel = {} as AnalyticsReadModel; // class-credentials never touches analytics
const YEAR = "2026-27";
const admin = principal("u_admin", { roles: ["admin"] });

/**
 * Fake source standing in for #11 B4's real one (identity-owned; see the
 * doc comment on ClassCredentialsSource for why this seam can't use the
 * usual re-fetch-at-generation-time contract). Admin-only is enforced HERE,
 * inside the source — exactly the "canProduce fully delegates" shape
 * grade-card/hall-ticket already use — to prove the seam supports it.
 */
const source: ClassCredentialsSource = async (caller, classId) => {
  if (classId === "cls_missing") return { access: "not-found" };
  if (!caller.roles.includes("admin")) return { access: "forbidden" };
  return {
    access: "ok",
    data: {
      classId,
      className: "FY BSc Computer Science, Section A",
      rows: [
        { rollNo: "1", studentName: "Ravi Kumar", username: "ravi.kumar", temporaryPassword: "Xk9mQ2vLp" },
        { rollNo: "2", studentName: "Anita Rao", username: "anita.rao", temporaryPassword: "Zt7nR4wSq" },
      ],
    },
  };
};

describe("class-credentials reporting kind (#11 B3)", () => {
  it("maps the source's access decision, failing closed without a source", async () => {
    const params = { kind: "class-credentials" as const, classId: "cls_1" };
    expect(await canProduce(readModel, admin, params, YEAR, { classCredentials: source })).toBe("ok");
    expect(await canProduce(readModel, principal("teacher"), params, YEAR, { classCredentials: source })).toBe("forbidden");
    expect(await canProduce(readModel, admin, { ...params, classId: "cls_missing" }, YEAR, { classCredentials: source })).toBe("not-found");
    expect(await canProduce(readModel, admin, params, YEAR)).toBe("not-found"); // no source wired
  });

  it("collects one table with roll no / name / username / temp password columns", async () => {
    const data = await collectReport(
      readModel,
      admin,
      { kind: "class-credentials", classId: "cls_1" },
      YEAR,
      "Admin User",
      { classCredentials: source },
    );
    expect(data).not.toBeNull();
    expect(data!.title).toBe("Class credential sheet");
    expect(data!.subtitle).toBe("FY BSc Computer Science, Section A");
    expect(data!.tables).toHaveLength(1);
    expect(data!.tables[0]!.columns).toEqual(["Roll no", "Name", "Username", "Temporary password"]);
    expect(data!.tables[0]!.rows).toEqual([
      ["1", "Ravi Kumar", "ravi.kumar", "Xk9mQ2vLp"],
      ["2", "Anita Rao", "anita.rao", "Zt7nR4wSq"],
    ]);
    expect(data!.rowCount).toBe(2);
    expect(data!.notes.some((note) => note.includes("plaintext temporary passwords"))).toBe(true);

    // Same ReportData the PDF draws — CSV renderer proves the shape, no PDF parsing needed here.
    const csv = renderCsv(data!);
    expect(csv).toContain("Xk9mQ2vLp");
    expect(csv).toContain("Zt7nR4wSq");
  });

  it("returns null (fail closed) for a non-admin caller even though the class exists", async () => {
    const data = await collectReport(
      readModel,
      principal("teacher"),
      { kind: "class-credentials", classId: "cls_1" },
      YEAR,
      "A Teacher",
      { classCredentials: source },
    );
    expect(data).toBeNull();
  });

  it("returns null (fail closed) without a source — kind unavailable until #11 B4 wires it", async () => {
    const data = await collectReport(readModel, admin, { kind: "class-credentials", classId: "cls_1" }, YEAR, "Admin User");
    expect(data).toBeNull();
  });
});
