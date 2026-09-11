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
  // ADMIN_ONLY endpoint. `username`/`status`/`grants` are deliberately present
  // in the fixture so the projection test below can prove they never leak.
  listUsers: vi.fn(async () => ({
    users: [
      {
        id: "u1", username: "vikram.rao", displayName: "Vikram Rao", roles: ["teacher"],
        status: "active", collegeId: "c1", grants: [], createdAt: "2026-01-01",
      },
    ],
  })),
};

beforeEach(() => {
  clearIndexCache();
  apiLike.colleges.mockClear();
  apiLike.collegeTree.mockClear();
  apiLike.sectionRoster.mockClear();
  apiLike.listUsers.mockClear();
});

describe("buildIndex", () => {
  it("indexes pages (role-filtered) + students projected WITHOUT PII", async () => {
    const idx = await buildIndex(apiLike, ["admin"]);
    const st = idx.find((e) => e.kind === "student")!;
    expect(st).toEqual({ kind: "student", label: "Asha Rao", roll: "23CS001", sub: "s1", href: "/students/st1" });
    expect(JSON.stringify(idx)).not.toMatch(/999|guardian|2005-01-01/); // no PII
    expect(idx.some((e) => e.kind === "page" && e.label === "Marks")).toBe(false); // Marks is teacher-only
    expect(idx.some((e) => e.kind === "page" && e.label === "Students")).toBe(true);
  });

  it("indexes staff for an admin, projected to label + roles only", async () => {
    const idx = await buildIndex(apiLike, ["admin"]);
    const staff = idx.find((e) => e.kind === "staff")!;
    expect(staff).toEqual({
      kind: "staff",
      label: "Vikram Rao",
      sub: "teacher",
      href: "/manage/teachers", // no per-teacher route exists — documented gap
    });
    // username is a login identifier; status/grants/createdAt are not needed to
    // render or navigate. None may reach a session-cached client-memory index.
    expect(JSON.stringify(idx)).not.toMatch(/vikram\.rao|createdAt|"grants"/);
  });

  it("does NOT fetch staff for a non-admin (listUsers is ADMIN_ONLY)", async () => {
    const idx = await buildIndex(apiLike, ["principal"]);
    expect(apiLike.listUsers).not.toHaveBeenCalled();
    expect(idx.some((e) => e.kind === "staff")).toBe(false);
  });

  it("still returns students and pages when the staff fetch fails", async () => {
    apiLike.listUsers.mockRejectedValueOnce(new Error("boom"));
    const idx = await buildIndex(apiLike, ["admin"]);
    expect(idx.some((e) => e.kind === "student")).toBe(true);
    expect(idx.some((e) => e.kind === "page")).toBe(true);
    expect(idx.some((e) => e.kind === "staff")).toBe(false);
  });

  it("filterIndex matches by name and by roll", async () => {
    const idx = await buildIndex(apiLike, ["admin"]);
    expect(filterIndex(idx, "asha").students).toHaveLength(1);
    expect(filterIndex(idx, "23cs001").students).toHaveLength(1);
  });

  it("filterIndex with empty query returns all pages, no students", async () => {
    const idx = await buildIndex(apiLike, ["admin"]);
    const { students, pages } = filterIndex(idx, "");
    expect(students).toHaveLength(0);
    expect(pages.length).toBeGreaterThan(0);
  });

  it("second buildIndex uses cache (no refetch)", async () => {
    await buildIndex(apiLike, ["admin"]);
    await buildIndex(apiLike, ["admin"]);
    expect(apiLike.colleges).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when roles change (cache keyed on roles — no cross-role serving)", async () => {
    await buildIndex(apiLike, ["admin"]);
    await buildIndex(apiLike, ["teacher"]);
    expect(apiLike.colleges).toHaveBeenCalledTimes(2);
  });

  it("getCachedIndex returns the built index, null after clear", async () => {
    expect(getCachedIndex()).toBeNull();
    const idx = await buildIndex(apiLike, ["admin"]);
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
      listUsers: async () => ({ users: [] }),
    };
    const idx = await buildIndex(api2, ["admin"]);
    expect(idx.some((e) => e.kind === "student" && e.label === "Bina Roy")).toBe(true); // survivor
    expect(idx.some((e) => e.kind === "page")).toBe(true); // page shortcuts survive
  });

  it("reports progress across pooled roster fetches", async () => {
    const progress: { done: number; total: number }[] = [];
    await buildIndex(apiLike, ["admin"], (done, total) => progress.push({ done, total }));
    expect(progress).toEqual([{ done: 1, total: 1 }]);
  });
});
