import { describe, expect, it, vi, afterEach } from "vitest";
import { api } from "./api";

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

  it("uses the shared school report-card contract exactly", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ students: [] }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ student: { id: "stu_1", fullName: "Meera Nair", admissionNo: "A-1" }, term: { id: "term_1", name: "Term 1", academicYear: "2026-27", startsOn: "2026-04-01", endsOn: "2026-09-30" }, subjects: [], overall: { percentage: null, grade: null, complete: false }, attendance: { eligibleDays: 0, presentEquivalentDays: null, percentage: null, complete: false, missingDates: [] }, warnings: [] }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ snapshotId: "snap_1", generatedAt: "2026-09-21T00:00:00.000Z" }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.schoolReportCardRoster("class_1", "term_1");
    await api.schoolReportCardPreview({ studentId: "stu_1", termId: "term_1" });
    await api.schoolGenerateReportCard({ studentId: "stu_1", termId: "term_1" });

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/school/report-cards/classes/class_1?termId=term_1");
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/v1/school/report-cards/preview");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "POST", body: JSON.stringify({ studentId: "stu_1", termId: "term_1" }) });
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/v1/school/report-cards");
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({ method: "POST", body: JSON.stringify({ studentId: "stu_1", termId: "term_1" }) });
    expect(api.schoolReportCardDownloadUrl("snap_1")).toBe("/api/v1/school/report-cards/snap_1/download");
  });
});
