import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import { SchoolClassWorkspacePage } from "./SchoolClassWorkspacePage";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: {
    ...actual.api,
    dashboard: vi.fn(), sectionRoster: vi.fn(), rosterAttendance: vi.fn(), colleges: vi.fn(), createStudent: vi.fn(),
  } };
});

const pupil = { id: "stu_1", collegeId: "col_1", admissionNo: "S-101", fullName: "Asha Sharma", status: "active", identityUserId: null, enrollment: null };
const classTile = { type: "class", classId: "cls_1", attendance: { state: "no-data" }, marks: { state: "no-data" }, atRisk: 0, strip: [{ sectionId: "sec_1", name: "A", days: [] }] };
const subjectTile = { type: "teacher-class", classId: "cls_1", subjectId: "sub_math", attendance: { state: "no-data" }, marks: { state: "no-data" }, atRisk: 0, strip: [{ sectionId: "sec_1", name: "A", days: [] }] };

function show() { return render(<ToastProvider><SchoolClassWorkspacePage /></ToastProvider>); }

beforeEach(() => {
  vi.clearAllMocks();
  (api.dashboard as ReturnType<typeof vi.fn>).mockResolvedValue({ academicYear: "2026-27", names: { cls_1: "Standard 8", sub_math: "Mathematics" }, tiles: [classTile, subjectTile] });
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({ students: [pupil] });
  (api.rosterAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({ cards: [{ studentId: "stu_1", counts: { present: 4, absent: 1, late: 0, excused: 0 }, attended: 4, total: 5, pct: 80, recent: [] }] });
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [{ id: "col_1" }] });
  (api.createStudent as ReturnType<typeof vi.fn>).mockResolvedValue({ ...pupil, id: "stu_2" });
});

describe("school class register", () => {
  it("shows a simple whole-class register and scoped daily actions", async () => {
    show();
    expect(await screen.findByText("Asha Sharma")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Take attendance/ })).toHaveAttribute("href", "/manage/attendance?sectionId=sec_1");
    expect(screen.getByRole("button", { name: "Add pupil" })).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.queryByText(/backlog|year.back|75%|fees due/i)).not.toBeInTheDocument();
    expect(api.rosterAttendance).toHaveBeenCalledWith("sec_1", { academicYear: expect.any(String) });
  });

  it("keeps the subject teacher's attendance scoped and hides enrolment", async () => {
    show();
    await screen.findByText("Asha Sharma");
    fireEvent.change(screen.getByLabelText("Class and section"), { target: { value: "sec_1:sub_math" } });
    await waitFor(() => expect(api.rosterAttendance).toHaveBeenCalledWith("sec_1", { academicYear: expect.any(String), subjectId: "sub_math" }));
    expect(screen.getByRole("link", { name: /Take attendance/ })).toHaveAttribute("href", "/manage/attendance?sectionId=sec_1&subjectId=sub_math");
    expect(screen.queryByRole("button", { name: "Add pupil" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter marks" })).toHaveAttribute("href", "/manage/marks");
  });

  it("enrols a pupil only from the whole-class register and refreshes the roster", async () => {
    show();
    await screen.findByText("Asha Sharma");
    fireEvent.click(screen.getByRole("button", { name: "Add pupil" }));
    fireEvent.change(screen.getByLabelText("Admission number"), { target: { value: "S-102" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Mira Das" } });
    fireEvent.change(screen.getByLabelText("Enrollment effective from"), { target: { value: "2026-09-23" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add pupil" }));
    await waitFor(() => expect(api.createStudent).toHaveBeenCalledWith({ collegeId: "col_1", admissionNo: "S-102", fullName: "Mira Das", sectionId: "sec_1", academicYear: expect.any(String), startsOn: "2026-09-23" }));
  });
});
