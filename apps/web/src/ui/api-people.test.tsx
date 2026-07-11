import { describe, expect, it, vi, afterEach } from "vitest";
import { api } from "./api";

afterEach(() => vi.restoreAllMocks());

function okJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("people api methods", () => {
  it("createDepartment POSTs the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: "dep_1", collegeId: "col_1", name: "Physics", code: "PHY" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const dep = await api.createDepartment({ collegeId: "col_1", name: "Physics", code: "PHY" });
    expect(dep.id).toBe("dep_1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/people/departments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ collegeId: "col_1", name: "Physics", code: "PHY" });
  });
  it("deleteOrgUnit DELETEs the typed unit path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await api.deleteOrgUnit("section", "sec_9");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/people/org/section/sec_9");
    expect(init.method).toBe("DELETE");
  });
  it("createTeacherAssignment posts kind+year to the teacher path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: "asg_1", teacherId: "tch_1", classId: "cls_1", subjectId: null, kind: "class_teacher", academicYear: "2026-27" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await api.createTeacherAssignment("tch_1", { classId: "cls_1", kind: "class_teacher", academicYear: "2026-27" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/people/teachers/tch_1/assignments");
    expect(JSON.parse(init.body)).toEqual({ classId: "cls_1", kind: "class_teacher", academicYear: "2026-27" });
  });
});
