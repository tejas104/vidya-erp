import { describe, expect, it, vi, afterEach } from "vitest";
import { api, ApiError } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("api mutation helpers", () => {
  it("recordAttendance POSTs the body and returns the session on 201", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "ses_1", sectionId: "sec_a", heldOn: "2026-06-01", slot: "day", academicYear: "2026-27", takenBy: "u", entries: [] }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = { sectionId: "sec_a", heldOn: "2026-06-01", slot: "day", academicYear: "2026-27", entries: [{ studentId: "stu_1", status: "present" as const }] };
    const res = await api.recordAttendance(body);
    expect(res.id).toBe("ses_1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/academics/attendance/sessions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("parses problem+json into ApiError on 422", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "x", title: "Entries outside the roster", status: 422, requestId: "r" }), { status: 422, headers: { "content-type": "application/problem+json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.recordAttendance({ sectionId: "s", heldOn: "2026-06-01", slot: "day", academicYear: "2026-27", entries: [{ studentId: "x", status: "present" }] }))
      .rejects.toMatchObject({ status: 422, message: "Entries outside the roster" });
  });
});
