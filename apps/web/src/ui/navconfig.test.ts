import { describe, expect, it } from "vitest";
import { visibleNav, crumbsFor } from "./navConfig";

describe("navConfig job-shaped regroup", () => {
  it("shows school term management only on the school edition and to oversight roles", () => {
    const links = (roles: Parameters<typeof visibleNav>[0], edition: "college" | "school") => visibleNav(roles, edition).flatMap((group) => group.entries).map((entry) => entry.href);
    expect(links(["admin"], "school")).toContain("/manage/terms");
    expect(links(["admin"], "college")).not.toContain("/manage/terms");
    expect(links(["teacher"], "school")).not.toContain("/manage/terms");
  });
  it("shows Report cards to school administrators, principals, and class teachers", () => {
    const links = (roles: Parameters<typeof visibleNav>[0], edition: "college" | "school") => visibleNav(roles, edition).flatMap((group) => group.entries);
    expect(links(["admin"], "school")).toEqual(expect.arrayContaining([expect.objectContaining({ href: "/manage/report-cards", label: "Report cards" })]));
    expect(links(["principal"], "school")).toEqual(expect.arrayContaining([expect.objectContaining({ href: "/manage/report-cards" })]));
    expect(links(["class_teacher"], "school")).toEqual(expect.arrayContaining([expect.objectContaining({ href: "/manage/report-cards" })]));
    expect(links(["teacher"], "school")).not.toEqual(expect.arrayContaining([expect.objectContaining({ href: "/manage/report-cards" })]));
    expect(links(["admin"], "college")).not.toEqual(expect.arrayContaining([expect.objectContaining({ href: "/manage/report-cards" })]));
    expect(crumbsFor("/manage/report-cards", "school")).toEqual([{ label: "Academics" }, { label: "Report cards" }]);
  });
  it("uses school terminology for term navigation and breadcrumbs without changing destinations", () => {
    const schoolTerms = visibleNav(["admin"], "school").flatMap((group) => group.entries).find((entry) => entry.href === "/manage/terms");
    expect(schoolTerms).toMatchObject({ label: "Academic Terms", href: "/manage/terms" });
    expect(crumbsFor("/manage/terms", "school")).toEqual([{ label: "Setup" }, { label: "Academic Terms" }]);
    expect(crumbsFor("/manage/terms", "college")).toEqual([]);
  });
  it("orders groups by job — daily work first, once-a-year SETUP last", () => {
    const g = visibleNav(["admin"]).map((x) => x.group);
    expect(g[0]).toBe("TOP");
    expect(g).toEqual(["TOP", "STUDENTS", "ACADEMICS", "MONEY", "PEOPLE", "REVIEW", "SETUP"]);
    expect(g[g.length - 1]).toBe("SETUP");
  });
  it("omits empty groups (no SETUP for accountant)", () => {
    expect(visibleNav(["accountant"]).map((x) => x.group)).not.toContain("SETUP");
  });
  it("Analytics is visible to oversight roles (admin/principal/hod) only", () => {
    const hrefs = (r: Parameters<typeof visibleNav>[0]) => visibleNav(r).flatMap((g) => g.entries).map((e) => e.href);
    expect(hrefs(["principal"])).toContain("/manage/analytics");
    expect(hrefs(["hod"])).toContain("/manage/analytics");
    // teaching-only staff see the focused "Now" dashboard, not analytics — no dead-end link
    expect(hrefs(["teacher"])).not.toContain("/manage/analytics");
    expect(hrefs(["class_teacher"])).not.toContain("/manage/analytics");
  });
  it("crumbsFor derives domain + label from NAV, none for dashboard", () => {
    expect(crumbsFor("/manage/marks")).toEqual([{ label: "Academics" }, { label: "Marks" }]);
    expect(crumbsFor("/manage/analytics")).toEqual([{ label: "Review" }, { label: "Analytics" }]);
    expect(crumbsFor("/dashboard")).toEqual([]);
  });
  it("keeps the two onboarding-import screens separate, filed by what each populates", () => {
    const groupOf = (href: string) => visibleNav(["admin"]).find((g) => g.entries.some((e) => e.href === href))?.group;
    expect(groupOf("/manage/import/students")).toBe("STUDENTS");
    expect(groupOf("/manage/import/staff")).toBe("PEOPLE");
    expect(crumbsFor("/manage/import/students")).toEqual([{ label: "Students" }, { label: "Import Students" }]);
  });

  it("puts a teacher's daily screens in the untitled TOP group, one tap from anywhere", () => {
    const top = visibleNav(["class_teacher"]).find((g) => g.group === "TOP")!.entries.map((e) => e.href);
    expect(top).toEqual(expect.arrayContaining(["/dashboard", "/manage/now", "/manage/attendance", "/manage/my-timetable", "/manage/coursework"]));
  });
});
