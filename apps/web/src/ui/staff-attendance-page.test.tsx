import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import StaffAttendancePage from "../../app/(app)/manage/staff-attendance/page";
import { api } from "./api";

const back = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, push }) }));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, colleges: vi.fn(), session: vi.fn(), listStaffAttendance: vi.fn(), saveStaffAttendance: vi.fn(), requestReport: vi.fn(), reportStatus: vi.fn() } };
});

const teacher = { id: "tch_1", collegeId: "col_1", staffNo: "T01", fullName: "Asha Rao", status: "active", identityUserId: null };

function renderPage() {
  return render(<ToastProvider><StaffAttendancePage /></ToastProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [{ id: "col_1", name: "Vidya School" }] });
  (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ roles: ["admin"] });
  (api.listStaffAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ teachers: [{ teacher, attendance: null }], nextOffset: null });
  (api.saveStaffAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ attendance: [] });
  (api.requestReport as ReturnType<typeof vi.fn>).mockResolvedValue("rpt_1");
  (api.reportStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "completed" });
});

describe("teacher attendance page", () => {
  it("offers a previous-section control with a dashboard fallback", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Back to previous section" }));
    expect(back.mock.calls.length + push.mock.calls.length).toBe(1);
  });

  it("saves only a changed teacher record, with date, status and note", async () => {
    renderPage();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 0 changes" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Asha Rao presence" }), { target: { value: "late" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Asha Rao note" }), { target: { value: "  After assembly  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));
    await waitFor(() => expect(api.saveStaffAttendance).toHaveBeenCalledTimes(1));
    expect(api.saveStaffAttendance).toHaveBeenCalledWith({
      collegeId: "col_1", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      entries: [{ teacherId: "tch_1", status: "late", note: "After assembly" }],
    });
  });

  it("shows a principal the dated register without edit controls or an admin directory link", async () => {
    (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ roles: ["principal"] });
    renderPage();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText(/an administrator records or corrects staff presence/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Asha Rao presence" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save .*change/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Teacher directory" })).not.toBeInTheDocument();
  });

  it("fills unmarked teachers without changing an existing absence or its note", async () => {
    (api.listStaffAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({
      teachers: [
        { teacher, attendance: { id: "sat_1", teacherId: teacher.id, attendedOn: "2026-09-25", status: "absent", note: "Reported ill", markedBy: "admin_1", updatedAt: "2026-09-25T08:00:00Z" } },
        { teacher: { ...teacher, id: "tch_2", staffNo: "T02", fullName: "Meera Shah" }, attendance: null },
      ], nextOffset: null,
    });
    renderPage();
    expect(await screen.findByText("Meera Shah")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark unmarked present" }));
    expect(screen.getByRole("combobox", { name: "Asha Rao presence" })).toHaveValue("absent");
    expect(screen.getByRole("textbox", { name: "Asha Rao note" })).toHaveValue("Reported ill");
    fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));
    await waitFor(() => expect(api.saveStaffAttendance).toHaveBeenCalledTimes(1));
    expect((api.saveStaffAttendance as ReturnType<typeof vi.fn>).mock.calls[0]![0].entries).toEqual([
      { teacherId: "tch_2", status: "present", note: null },
    ]);
  });

  it("offers PDF, Excel and CSV for the complete selected school day", async () => {
    renderPage();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare CSV" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare Excel" }));
    await waitFor(() => expect(api.requestReport).toHaveBeenCalledTimes(1));
    expect(api.requestReport).toHaveBeenCalledWith(
      { kind: "teacher-attendance", collegeId: "col_1", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      "xlsx", expect.stringMatching(/^\d{4}-\d{2}$/),
    );
    expect(await screen.findByRole("link", { name: "Download XLSX" })).toHaveAttribute("href", "/api/v1/reports/rpt_1/download");
  });
});
