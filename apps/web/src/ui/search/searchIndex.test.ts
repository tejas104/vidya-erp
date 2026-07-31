import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildIndex, filterIndex, clearIndexCache, getCachedIndex } from "./searchIndex";

const apiLike = {
  colleges: vi.fn(async () => ({ colleges: [{ id: "c1", name: "C", code: "C" }] })),
  collegeTree: vi.fn(async () => ({
    college: { id: "c1", name: "C", code: "C" },
    departments: [
      {
        id: "d", collegeId: "c1", name: "D", code: "D",
        classes: [{ id: "cl", departmentId: "d", name: "I", code: "I", sections: [{ id: "s1", classId: "cl", name: "A" }] }],
        subjects: [],
      },
    ],
  })),
  sectionRoster: vi.fn(async () => ({
    students: [
      {
        id: "st1", collegeId: "c1", admissionNo: "23CS001", fullName: "Asha Rao", status: "active",
        identityUserId: null, enrollment: { sectionId: "s1", academicYear: "2026" },
        phone: "999", guardianName: "X", guardianPhone: "8", dob: "2005-01-01",
      },
    ],
  })),
};

beforeEach(() => {
  clearIndexCache();
  apiLike.colleges.mockClear();
  apiLike.collegeTree.mockClear();
  apiLike.sectionRoster.mockClear();
});

describe("buildIndex", () => {
  it("indexes pages (role-filtered) + students projected WITHOUT PII", async () => {
    const idx = await buildIndex(apiLike as any, ["admin"]);
    const st = idx.find((e) => e.kind === "student")!;
    expect(st).toEqual({ kind: "student", label: "Asha Rao", roll: "23CS001", sub: "s1", href: "/students/st1" });
    expect(JSON.stringify(idx)).not.toMatch(/999|guardian|2005-01-01/); // no PII
    expect(idx.some((e) => e.kind === "page" && e.label === "Marks")).toBe(false); // Marks is teacher-only
    expect(idx.some((e) => e.kind === "page" && e.label === "Students")).toBe(true);
  });

  it("filterIndex matches by name and by roll", async () => {
    const idx = await buildIndex(apiLike as any, ["admin"]);
    expect(filterIndex(idx, "asha").students).toHaveLength(1);
    expect(filterIndex(idx, "23cs001").students).toHaveLength(1);
  });

  it("filterIndex with empty query returns all pages, no students", async () => {
    const idx = await buildIndex(apiLike as any, ["admin"]);
    const { students, pages } = filterIndex(idx, "");
    expect(students).toHaveLength(0);
    expect(pages.length).toBeGreaterThan(0);
  });

  it("second buildIndex uses cache (no refetch)", async () => {
    await buildIndex(apiLike as any, ["admin"]);
    await buildIndex(apiLike as any, ["admin"]);
    expect(apiLike.colleges).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when roles change (cache keyed on roles — no cross-role serving)", async () => {
    await buildIndex(apiLike as any, ["admin"]);
    await buildIndex(apiLike as any, ["teacher"]);
    expect(apiLike.colleges).toHaveBeenCalledTimes(2);
  });

  it("getCachedIndex returns the built index, null after clear", async () => {
    expect(getCachedIndex()).toBeNull();
    const idx = await buildIndex(apiLike as any, ["admin"]);
    expect(getCachedIndex()).toBe(idx);
    clearIndexCache();
    expect(getCachedIndex()).toBeNull();
  });

  it("a failing section roster doesn't sink the index (pages + other students survive)", async () => {
    const tree2 = {
      college: { id: "c1", name: "C", code: "C" },
      departments: [
        {
          id: "d", collegeId: "c1", name: "D", code: "D",
          classes: [{ id: "cl", departmentId: "d", name: "I", code: "I", sections: [
            { id: "s1", classId: "cl", name: "A" },
            { id: "s2", classId: "cl", name: "B" },
          ] }],
          subjects: [],
        },
      ],
    };
    const roster = vi
      .fn()
      .mockRejectedValueOnce(new Error("500")) // s1 transient failure
      .mockResolvedValueOnce({
        students: [
          {
            id: "st2", collegeId: "c1", admissionNo: "23CS002", fullName: "Bina Roy", status: "active",
            identityUserId: null, enrollment: { sectionId: "s2", academicYear: "2026" },
            phone: null, guardianName: null, guardianPhone: null, dob: null,
          },
        ],
      });
    const api2 = {
      colleges: async () => ({ colleges: [{ id: "c1" }] }),
      collegeTree: async () => tree2,
      sectionRoster: roster,
    };
    const idx = await buildIndex(api2 as any, ["admin"]);
    expect(idx.some((e) => e.kind === "student" && e.label === "Bina Roy")).toBe(true); // survivor
    expect(idx.some((e) => e.kind === "page")).toBe(true); // page shortcuts survive
  });

  it("reports progress across pooled roster fetches", async () => {
    const progress: { done: number; total: number }[] = [];
    await buildIndex(apiLike as any, ["admin"], (done, total) => progress.push({ done, total }));
    expect(progress).toEqual([{ done: 1, total: 1 }]);
  });
});
