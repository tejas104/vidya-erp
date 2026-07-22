import { describe, expect, it } from "vitest";
import { visibleNav, crumbsFor } from "./navConfig";

describe("navConfig 7-domain regroup", () => {
  it("orders groups TOP→PEOPLE→ACADEMICS→…→ADMINISTRATION for admin", () => {
    const g = visibleNav(["admin"]).map((x) => x.group);
    expect(g[0]).toBe("TOP");
    expect(g).toEqual(["TOP", "PEOPLE", "ACADEMICS", "FEES", "COMMUNICATION", "REPORTS", "ADMINISTRATION"]);
  });
  it("omits empty groups (no ANALYTICS; accountant has no ACADEMICS)", () => {
    expect(visibleNav(["accountant"]).map((x) => x.group)).not.toContain("ANALYTICS");
  });
  it("crumbsFor derives domain + label from NAV, none for dashboard", () => {
    expect(crumbsFor("/manage/marks")).toEqual([{ label: "Academics" }, { label: "Marks" }]);
    expect(crumbsFor("/dashboard")).toEqual([]);
  });
});
