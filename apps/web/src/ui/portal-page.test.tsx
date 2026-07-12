import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalPage from "../../app/(app)/portal/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, portalMe: vi.fn(), portalAttendance: vi.fn(), portalMarks: vi.fn(), portalTimetable: vi.fn(), portalToday: vi.fn(), cwkMyAssignments: vi.fn(), cwkMyMaterials: vi.fn() },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.portalMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    student: { id: "stu_1", admissionNo: "FYCS-001", fullName: "Aarav Sharma", status: "active" },
    enrollment: { sectionId: "sec_1", sectionName: "A", className: "FY CS", academicYear: "2026-27" },
  });
  (api.portalAttendance as ReturnType<typeof vi.fn>).mockResolvedValue({
    counts: { present: 15, absent: 4, late: 1, excused: 0 },
    pct: 80,
    monthly: [{ month: "2026-06", pct: 75 }, { month: "2026-07", pct: 90 }],
    sessions: [{ heldOn: "2026-07-10", status: "present" }],
  });
  (api.portalTimetable as ReturnType<typeof vi.fn>).mockResolvedValue({
    periods: [{ periodNo: 1, starts: "09:00", ends: "09:50" }],
    entries: [{ id: "tte_1", sectionId: "sec_1", subjectId: "sub_1", subjectName: "Data Structures", teacherId: "tch_1", teacherName: "Anita Desai", room: "204", dayOfWeek: 1, periodNo: 1 }],
  });
  (api.portalToday as ReturnType<typeof vi.fn>).mockResolvedValue({
    dayOfWeek: 1,
    periods: [{ periodNo: 1, starts: "09:00", ends: "09:50" }],
    entries: [{ id: "tte_1", sectionId: "sec_1", subjectId: "sub_1", subjectName: "Data Structures", teacherId: "tch_1", teacherName: "Anita Desai", room: "204", dayOfWeek: 1, periodNo: 1 }],
  });
  (api.cwkMyAssignments as ReturnType<typeof vi.fn>).mockResolvedValue({ assignments: [] });
  (api.cwkMyMaterials as ReturnType<typeof vi.fn>).mockResolvedValue({ materials: [] });
  (api.portalMarks as ReturnType<typeof vi.fn>).mockResolvedValue({
    subjects: [
      {
        subjectId: "sub_1", name: "Data Structures", avgPct: 72,
        marks: [{ assessmentName: "Quiz 1", kind: "quiz", pct: 80, heldOn: "2026-06-10" }],
      },
    ],
    overallPct: 72,
  });
});

describe("/portal (student self-view)", () => {
  it("renders the student's own figures", async () => {
    render(<PortalPage />);
    expect(await screen.findByText(/Hello, Aarav\./)).toBeInTheDocument();
    expect(screen.getAllByText("80%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Data Structures/).length).toBeGreaterThanOrEqual(1);
  });
  it("shows the unlinked state on 404", async () => {
    const { ApiError } = await import("./api");
    (api.portalMe as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(404, "not linked"));
    render(<PortalPage />);
    expect(await screen.findByText(/isn't linked to a student record/)).toBeInTheDocument();
  });
});
