import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AttendancePage from "../../app/(app)/manage/attendance/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, dashboard: vi.fn(), sectionRoster: vi.fn(), recordAttendance: vi.fn(), sessionAttendance: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.dashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
    academicYear: "2026-27",
    names: { cls_1: "FY CS", sec_a: "A" },
    tiles: [{ type: "class", classId: "cls_1", attendance: { state: "no-data" }, marks: { state: "no-data" }, atRisk: 0, strip: [{ sectionId: "sec_a", name: "A", days: [] }] }],
  });
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({ students: [{ id: "stu_1", fullName: "Aarav Sharma", admissionNo: "FYCS-001" }] });
  (api.sessionAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [] });
  (api.recordAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ses_1", sectionId: "sec_a", heldOn: "2026-06-01", slot: "day", academicYear: "2026-27", takenBy: "u", entries: [] });
});

describe("attendance entry", () => {
  it("loads the roster for the caller's section and submits present-by-default entries", async () => {
    render(<AttendancePage />);
    // roster appears
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    // submit
    fireEvent.click(screen.getByRole("button", { name: /save attendance/i }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledTimes(1));
    const body = (api.recordAttendance as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.sectionId).toBe("sec_a");
    expect(body.entries).toEqual([{ studentId: "stu_1", status: "present" }]);
  });
});
