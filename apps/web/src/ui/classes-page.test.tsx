import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ClassWorkspacePage from "../../app/(app)/manage/classes/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      session: vi.fn(),
      dashboard: vi.fn(),
      sectionRoster: vi.fn(),
      rosterAttendance: vi.fn(),
      feesSectionInvoices: vi.fn(),
      ttMyToday: vi.fn(),
    },
  };
});

const student = (id: string, admissionNo: string, fullName: string, status = "active") => ({
  id, collegeId: "c", admissionNo, fullName, status, identityUserId: null, enrollment: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "u1", displayName: "Anita", roles: ["teacher", "class_teacher"], grants: [],
  });
  (api.dashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
    academicYear: "2026-27",
    names: { cls_1: "SY CS", sub_ds: "Data Structures" },
    tiles: [
      {
        type: "teacher-class",
        classId: "cls_1",
        subjectId: "sub_ds",
        attendance: { state: "no-data" },
        marks: { state: "no-data" },
        atRisk: 0,
        strip: [{ sectionId: "sec_a", name: "A", days: [] }],
      },
    ],
  });
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({
    students: [student("stu_1", "2401", "Aarav Sharma"), student("stu_2", "2402", "Sanika Kulkarni")],
  });
  (api.rosterAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({
    cards: [
      { studentId: "stu_1", counts: { present: 9, absent: 1, late: 0, excused: 0 }, attended: 9, total: 10, pct: 90, recent: [] },
      { studentId: "stu_2", counts: { present: 5, absent: 5, late: 0, excused: 0 }, attended: 5, total: 10, pct: 50, recent: [] },
    ],
  });
  (api.feesSectionInvoices as ReturnType<typeof vi.fn>).mockResolvedValue({ invoices: [] });
  (api.ttMyToday as ReturnType<typeof vi.fn>).mockResolvedValue({ dayOfWeek: 2, periods: [], entries: [] });
});

describe("class workspace — flashcards", () => {
  it("renders a StudentCard per roster student with attendance %, subject-scoped", async () => {
    render(<ClassWorkspacePage />);
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("Sanika Kulkarni")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument(); // attendance ring reads the number
    expect(api.rosterAttendance).toHaveBeenCalledWith("sec_a", { academicYear: "2026-27", subjectId: "sub_ds" });
  });

  it("flags a short-attendance student (below 75%) with the short badge", async () => {
    render(<ClassWorkspacePage />);
    await screen.findByText("Sanika Kulkarni");
    // Sanika at 50% earns a 'short' badge; Aarav at 90% shows 'clear'.
    expect(screen.getByText("short", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("clear")).toBeInTheDocument();
  });

  it("wires per-student fees: a student with dues surfaces the Fees-due filter", async () => {
    (api.feesSectionInvoices as ReturnType<typeof vi.fn>).mockResolvedValue({
      invoices: [{ studentId: "stu_2", duesPaise: 50_000 }],
    });
    render(<ClassWorkspacePage />);
    await screen.findByText("Sanika Kulkarni");
    expect(await screen.findByText("Fees due")).toBeInTheDocument();
  });
});
