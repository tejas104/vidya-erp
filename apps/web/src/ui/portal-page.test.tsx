import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalPage from "../../app/(app)/portal/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, portalMe: vi.fn(), portalAttendance: vi.fn(), portalMarks: vi.fn(), portalTimetable: vi.fn(), portalToday: vi.fn(), cwkMyAssignments: vi.fn(), cwkMyMaterials: vi.fn(), feesMyFees: vi.fn(), resMyResults: vi.fn() },
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
  (api.feesMyFees as ReturnType<typeof vi.fn>).mockResolvedValue({
    invoices: [{
      id: "inv_1", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1",
      studentId: "stu_1", studentName: "Aarav Sharma", admissionNo: "FYCS-001",
      structureId: "str_1", headId: "head_1", headName: "Tuition", academicYear: "2026-27",
      amountPaise: 50_000, dueOn: "2026-08-01", status: "part", paidPaise: 25_000, duesPaise: 25_000,
      payments: [{ id: "pay_1", invoiceId: "inv_1", receiptNo: 12, amountPaise: 25_000, mode: "upi", ref: "", receivedBy: "u_acct", receivedAt: "2026-07-01T09:00:00Z" }],
      adjustments: [],
    }],
  });
  (api.resMyResults as ReturnType<typeof vi.fn>).mockResolvedValue({
    terms: [{
      term: "Term 1", academicYear: "2026-27", publishedAt: "2026-07-12T09:00:00Z", sgpa: 8.3,
      subjects: [{ subjectId: "sub_1", subjectName: "Data Structures", credits: 4, pct: 78.5, grade: "B+", points: 8 }],
    }],
    cgpa: 8.3,
  });
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
  it("shows my fees with dues headline and receipt history", async () => {
    render(<PortalPage />);
    expect(await screen.findByText("My fees")).toBeInTheDocument();
    expect(screen.getByText("Dues: ₹250.00")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("part")).toBeInTheDocument();
  });
  it("hides the fees section when the fees module doesn't answer", async () => {
    (api.feesMyFees as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not deployed"));
    render(<PortalPage />);
    await screen.findByText(/Hello, Aarav\./);
    expect(screen.queryByText("My fees")).not.toBeInTheDocument();
  });
  it("shows a published term with big SGPA and grade chips", async () => {
    render(<PortalPage />);
    expect(await screen.findByText("My results")).toBeInTheDocument();
    expect(screen.getAllByText("8.30").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("B+")).toBeInTheDocument();
    expect(screen.getByText("CGPA 8.30")).toBeInTheDocument();
  });
  it("shows the withheld state when nothing is published", async () => {
    (api.resMyResults as ReturnType<typeof vi.fn>).mockResolvedValue({ terms: [], cgpa: null });
    render(<PortalPage />);
    expect(await screen.findByText("Results aren't published yet.")).toBeInTheDocument();
  });
  it("hides the results section when the results module doesn't answer", async () => {
    (api.resMyResults as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not deployed"));
    render(<PortalPage />);
    await screen.findByText(/Hello, Aarav\./);
    expect(screen.queryByText("My results")).not.toBeInTheDocument();
  });
  it("shows the unlinked state on 404", async () => {
    const { ApiError } = await import("./api");
    (api.portalMe as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(404, "not linked"));
    render(<PortalPage />);
    expect(await screen.findByText(/isn't linked to a student record/)).toBeInTheDocument();
  });
});
