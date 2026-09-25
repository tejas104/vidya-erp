import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import AttendancePage from "../../app/(app)/manage/attendance/page";
import { api } from "./api";

const back = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, push }) }));

function renderPage() {
  return render(
    <ToastProvider>
      <AttendancePage />
    </ToastProvider>,
  );
}

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, dashboard: vi.fn(), sectionRoster: vi.fn(), recordAttendance: vi.fn(), sessionAttendance: vi.fn(), getSession: vi.fn(), rosterAttendance: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.dashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
    academicYear: "2026-27",
    names: { cls_1: "FY CS", sec_a: "A" },
    tiles: [{ type: "class", classId: "cls_1", attendance: { state: "no-data" }, marks: { state: "no-data" }, atRisk: 0, strip: [{ sectionId: "sec_a", name: "A", days: [] }] }],
  });
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({
    students: [
      { id: "stu_1", fullName: "Aarav Sharma", admissionNo: "FYCS-001", status: "active" },
      { id: "stu_2", fullName: "Bhavna Rao", admissionNo: "FYCS-002", status: "active" },
    ],
  });
  (api.sessionAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [] });
  (api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ses_existing", sectionId: "sec_a", heldOn: new Date().toISOString().slice(0, 10), slot: "day", subjectId: "", academicYear: "2026-27", takenBy: "u", entries: [{ studentId: "stu_1", status: "present" }, { studentId: "stu_2", status: "present" }] });
  (api.rosterAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ cards: [] });
  (api.recordAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ses_1", sectionId: "sec_a", heldOn: "2026-06-01", slot: "day", academicYear: "2026-27", takenBy: "u", entries: [] });
});

describe("attendance register", () => {
  it("offers a visible previous-section control with a safe classes fallback", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Back to previous section" }));
    expect(back.mock.calls.length + push.mock.calls.length).toBe(1);
  });
  it("blocks a second register for the same section, date and period", async () => {
    const today = new Date().toISOString().slice(0, 10);
    (api.sessionAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [{ id: "ses_existing", heldOn: today, slot: "day", subjectId: "", academicYear: "2026-27", counts: { present: 2, absent: 0, late: 0, excused: 0 } }] });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Attendance recorded" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save attendance$/i })).not.toBeInTheDocument();
    expect(screen.getByText("2 present")).toBeInTheDocument();
    expect(await screen.findAllByText("present")).toHaveLength(2);
    expect(api.sessionAttendance).toHaveBeenCalledWith("sec_a", { from: today, to: today, limit: 100 });
  });

  it("loads the roster present-by-default and Save submits every student as present", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /Aarav Sharma, roll FYCS-001 — present/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save attendance$/i }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledTimes(1));
    const body = (api.recordAttendance as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.sectionId).toBe("sec_a");
    expect(body.entries).toEqual([
      { studentId: "stu_1", status: "present" },
      { studentId: "stu_2", status: "present" },
    ]);
  });

  it("one tap marks a student absent — aria-pressed flips and the running count updates — a second tap restores present", async () => {
    renderPage();
    const cell = await screen.findByRole("button", { name: /Aarav Sharma, roll FYCS-001 — present/ });
    expect(cell).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/2 present/)).toBeInTheDocument();
    expect(screen.getByText(/0 absent/)).toBeInTheDocument();

    fireEvent.click(cell);
    const absentCell = screen.getByRole("button", { name: /Aarav Sharma, roll FYCS-001 — absent/ });
    expect(absentCell).toHaveAttribute("aria-pressed", "true");
    // running absentee count is now 1
    expect(screen.getByText(/1 present/)).toBeInTheDocument();
    expect(screen.getByText(/1 absent/)).toBeInTheDocument();

    fireEvent.click(absentCell);
    expect(screen.getByRole("button", { name: /Aarav Sharma, roll FYCS-001 — present/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/2 present/)).toBeInTheDocument();
  });

  it("touch fast path: mark an absentee, then 'All present' resets before save", async () => {
    renderPage();
    await screen.findByRole("button", { name: /Aarav Sharma/ });
    fireEvent.click(screen.getByRole("button", { name: /Aarav Sharma, roll FYCS-001 — present/ }));
    fireEvent.click(screen.getByRole("button", { name: /all present/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save attendance$/i }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledTimes(1));
    const body = (api.recordAttendance as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.entries).toEqual([
      { studentId: "stu_1", status: "present" },
      { studentId: "stu_2", status: "present" },
    ]);
  });

  it("the secondary control marks a student late without touching the primary toggle, and Save carries it through", async () => {
    renderPage();
    await screen.findByRole("button", { name: /Aarav Sharma/ });
    const secondary = screen.getByRole("combobox", { name: /mark aarav sharma late or excused/i });
    fireEvent.change(secondary, { target: { value: "late" } });

    expect(screen.getByRole("button", { name: /Aarav Sharma, roll FYCS-001 — late/ })).toHaveAttribute("aria-pressed", "mixed");

    fireEvent.click(screen.getByRole("button", { name: /^save attendance$/i }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledTimes(1));
    const body = (api.recordAttendance as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.entries).toEqual([
      { studentId: "stu_1", status: "late" },
      { studentId: "stu_2", status: "present" },
    ]);
  });
});
