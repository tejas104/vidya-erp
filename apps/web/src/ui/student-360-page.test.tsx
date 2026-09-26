import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StudentPage from "../../app/(app)/students/[studentId]/page";
import { api, ApiError } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: {
    ...actual.api,
    session: vi.fn(), studentGet: vi.fn(), studentPerformance: vi.fn(),
    studentMarks: vi.fn(), studentAttendance: vi.fn(), feesStudentInvoices: vi.fn(),
    studentHistory: vi.fn(), progressionReverse: vi.fn(), docList: vi.fn(),
  } };
});

const profile = {
  id: "stu_1", collegeId: "col_1", admissionNo: "S-001", fullName: "Meera Record",
  status: "active", identityUserId: null, phone: null, guardianName: null,
  guardianPhone: null, dob: null,
  enrollment: { sectionId: "sec_1", sectionName: "B", classId: "cls_1", className: "Standard Eight", academicYear: "2026-27" },
};

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/students/stu_1");
  (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u_1", displayName: "Admin", roles: ["admin"], grants: [] });
  (api.studentGet as ReturnType<typeof vi.fn>).mockResolvedValue(profile);
  (api.studentPerformance as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(403, "denied"));
  (api.studentHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
    enrollments: [
      { id: "enr_old", sectionId: "sec_old", sectionName: "A", classId: "cls_1", className: "Standard Eight", academicYear: "2026-27", status: "withdrawn", createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
      { id: "enr_new", sectionId: "sec_1", sectionName: "B", classId: "cls_1", className: "Standard Eight", academicYear: "2026-27", status: "enrolled", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
    ], statusChanges: [], events: [{ action: "people.student-enrolled", actorId: "u_1", occurredAt: "2026-07-01T00:00:00Z", details: {} }], correctedEnrollmentIds: [],
  });
  (api.feesStudentInvoices as ReturnType<typeof vi.fn>).mockResolvedValue({ invoices: [{
    id: "inv_1", headName: "Tuition", academicYear: "2026-27", dueOn: "2026-10-01",
    duesPaise: 120000,
  }] });
});

function renderPage() {
  const value = { studentId: "stu_1" };
  const params = Object.assign(Promise.resolve(value), { status: "fulfilled", value });
  return render(<StudentPage params={params} />);
}

describe("Student 360", () => {
  it("records one administrator correction with a reason and refreshes history", async () => {
    (api.studentHistory as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      enrollments: [{ id: "enr_old", sectionId: "sec_old", sectionName: "A", classId: "cls_1", className: "Standard Eight", academicYear: "2026-27", status: "withdrawn", outcome: "transferred_out", outcomeReason: "Moved", createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" }],
      statusChanges: [], events: [], correctedEnrollmentIds: [],
    }).mockResolvedValueOnce({
      enrollments: [{ id: "enr_old", sectionId: "sec_old", sectionName: "A", classId: "cls_1", className: "Standard Eight", academicYear: "2026-27", status: "withdrawn", outcome: "transferred_out", outcomeReason: "Moved", createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" }],
      statusChanges: [], events: [], correctedEnrollmentIds: ["enr_old"],
    });
    (api.progressionReverse as ReturnType<typeof vi.fn>).mockResolvedValue({ correctionId: "prc_1", reinstatedEnrollmentId: "enr_return" });
    renderPage();
    await screen.findByRole("heading", { name: "Meera Record" });
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: "Correct this outcome" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for correcting this outcome" }), { target: { value: "Wrong pupil chosen" } });
    fireEvent.click(screen.getByRole("button", { name: "Record correction" }));
    await waitFor(() => expect(api.progressionReverse).toHaveBeenCalledWith("stu_1", "enr_old", "Wrong pupil chosen"));
    expect(await screen.findByText(/Outcome corrected; the original record is retained/)).toBeInTheDocument();
  });
  it("keeps the profile and history usable when analytics denies the summary panel", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Meera Record" })).toBeInTheDocument();
    expect(screen.getByText(/Admission S-001/)).toHaveTextContent("Standard Eight");
    expect(await screen.findByText("Not in your scope.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const enrollments = await screen.findByRole("region", { name: "Enrollment history" });
    expect(within(enrollments).getByText(/Section A/)).toBeInTheDocument();
    expect(within(enrollments).getByText(/Section B/)).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-history");
    expect(window.location.search).toBe("?tab=history");
  });

  it("shows an accountant the profile and finance, with separate academic denial states", async () => {
    (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u_2", displayName: "Accountant", roles: ["accountant"], grants: [] });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Meera Record" })).toBeInTheDocument();
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "Academics" }));
    expect(screen.getByText("Not in your scope.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Attendance" }));
    expect(screen.getByText("Not in your scope.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Finance" }));
    expect(await screen.findByText("Tuition")).toBeInTheDocument();
    expect(screen.getAllByText(/₹1,200/).length).toBeGreaterThan(0);
  });
});
