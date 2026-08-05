import { describe, expect, it } from "vitest";
import { visibleNav, crumbsFor } from "./navConfig";

describe("navConfig 8-domain regroup", () => {
  it("orders groups TOP→PEOPLE→ACADEMICS→…→ANALYTICS→ADMINISTRATION for admin", () => {
    const g = visibleNav(["admin"]).map((x) => x.group);
    expect(g[0]).toBe("TOP");
    expect(g).toEqual(["TOP", "PEOPLE", "ACADEMICS", "FEES", "COMMUNICATION", "REPORTS", "ANALYTICS", "ADMINISTRATION"]);
  });
  it("omits empty groups (no ANALYTICS for accountant)", () => {
    expect(visibleNav(["accountant"]).map((x) => x.group)).not.toContain("ANALYTICS");
  });
  it("ANALYTICS is visible to oversight roles (admin/principal/hod) only", () => {
    expect(visibleNav(["principal"]).map((x) => x.group)).toContain("ANALYTICS");
    expect(visibleNav(["hod"]).map((x) => x.group)).toContain("ANALYTICS");
    // teaching-only staff see the focused "Now" dashboard, not analytics — no dead-end link
    expect(visibleNav(["teacher"]).map((x) => x.group)).not.toContain("ANALYTICS");
    expect(visibleNav(["class_teacher"]).map((x) => x.group)).not.toContain("ANALYTICS");
  });
  it("crumbsFor derives domain + label from NAV, none for dashboard", () => {
    expect(crumbsFor("/manage/marks")).toEqual([{ label: "Academics" }, { label: "Marks" }]);
    expect(crumbsFor("/manage/analytics")).toEqual([{ label: "Analytics" }, { label: "Analytics" }]);
    expect(crumbsFor("/dashboard")).toEqual([]);
  });
  it("PEOPLE carries the two onboarding-import screens for admin, not a merged 'Import'", () => {
    const people = visibleNav(["admin"]).find((g) => g.group === "PEOPLE")!.entries;
    expect(people.map((e) => e.label)).toEqual(
      expect.arrayContaining(["Import Students", "Import Staff"]),
    );
    expect(people.find((e) => e.href === "/manage/import/students")).toBeDefined();
    expect(people.find((e) => e.href === "/manage/import/staff")).toBeDefined();
    expect(crumbsFor("/manage/import/students")).toEqual([{ label: "People" }, { label: "Import Students" }]);
  });
});
