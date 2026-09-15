import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import { SchoolMarksPage } from "./SchoolMarksPage";
import { api, type SchoolAssessmentView } from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, dashboard: vi.fn(), schoolClassSetup: vi.fn(), schoolAssessments: vi.fn(), sectionRoster: vi.fn(), schoolCreateAssessment: vi.fn(), schoolMarks: vi.fn(), schoolEnterMarks: vi.fn() } };
});
const assessment: SchoolAssessmentView = { id: "as_1", termId: "term_1", typeId: "type_1", classId: "cls_1", subjectId: "math", name: "Unit test", academicYear: "2026-27", maxScore: 20, heldOn: "2026-06-01" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.dashboard).mockResolvedValue({ academicYear: "2026-27", names: { cls_1: "Standard 6", math: "Math" }, tiles: [{ type: "teacher-class", classId: "cls_1", subjectId: "math", attendance: { state: "no-data" }, marks: { state: "no-data" }, atRisk: 0, strip: [{ sectionId: "sec_1", name: "A", days: [] }] }] });
  vi.mocked(api.schoolClassSetup).mockResolvedValue({ terms: [{ id: "term_1", name: "Term 1", academicYear: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", status: "open", scaleId: null, scaleName: null, types: [{ id: "type_1", name: "Exam", weight: 100 }] }], scales: [{ id: "scale_1", name: "School scale" }] });
  vi.mocked(api.schoolAssessments).mockResolvedValue({ assessments: [assessment] });
  vi.mocked(api.sectionRoster).mockResolvedValue({ students: [{ id: "stu_1", fullName: "Meera Nair", admissionNo: "001", collegeId: "school", status: "active", identityUserId: null, enrollment: null, phone: null, guardianName: null, guardianPhone: null, dob: null }] });
  vi.mocked(api.schoolMarks).mockResolvedValue({ marks: [], termStatus: "open" });
  vi.mocked(api.schoolCreateAssessment).mockResolvedValue(assessment);
});
function show() { render(<ToastProvider><SchoolMarksPage /></ToastProvider>); }
async function open() { show(); fireEvent.click(await screen.findByRole("button", { name: "Open marks" })); }

describe("School marks entry", () => {
  it("uses Academic Year and Term labels for school assessment setup", async () => {
    show();
    expect(await screen.findByText(/recorded grades for the academic year/i)).toBeInTheDocument();
    expect(await screen.findByLabelText("Term")).toBeInTheDocument();
    expect(screen.queryByLabelText("Academic term")).not.toBeInTheDocument();
  });

  it("creates a term-linked assessment with the selected grading scale", async () => {
    show();
    fireEvent.change(await screen.findByLabelText("Assessment name"), { target: { value: "Unit test" } });
    fireEvent.change(screen.getByLabelText("Assessment date"), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create assessment" }));
    await waitFor(() => expect(api.schoolCreateAssessment).toHaveBeenCalledWith(expect.objectContaining({ termId: "term_1", typeId: "type_1", scaleId: "scale_1", maxScore: 20 })));
    expect(await screen.findByLabelText("score for Meera Nair")).toBeInTheDocument();
    expect(screen.getByLabelText("Grade scale")).toBeDisabled();
  });
  it("saves entered scores and displays the server's recorded grade", async () => {
    vi.mocked(api.schoolEnterMarks).mockResolvedValue({ marks: [{ id: "mark_1", assessmentId: "as_1", studentId: "stu_1", score: 16, percentage: 80, grade: "A", points: 10, recordedBy: "teacher", updatedAt: "2026-06-01T10:00:00Z" }] });
    await open();
    fireEvent.change(await screen.findByLabelText("score for Meera Nair"), { target: { value: "16" } });
    fireEvent.click(screen.getByRole("button", { name: /save marks/i }));
    await waitFor(() => expect(api.schoolEnterMarks).toHaveBeenCalledWith("as_1", [{ studentId: "stu_1", score: 16 }]));
    expect(await screen.findByText("16/20")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
  it("retains entered scores after a failed save so the teacher can retry", async () => {
    vi.mocked(api.schoolEnterMarks).mockRejectedValue(new Error("network"));
    await open();
    fireEvent.change(await screen.findByLabelText("score for Meera Nair"), { target: { value: "16" } });
    fireEvent.click(screen.getByRole("button", { name: /save marks/i }));
    expect(await screen.findByText("Couldn't save marks. Please retry.")).toBeInTheDocument();
    expect(screen.getByLabelText("score for Meera Nair")).toHaveValue(16);
  });
  it("shows closed terms as read only", async () => {
    vi.mocked(api.schoolMarks).mockResolvedValue({ marks: [], termStatus: "closed" });
    await open();
    expect(await screen.findByText("Term closed · marks are read only.")).toBeInTheDocument();
    expect(screen.queryByLabelText("score for Meera Nair")).not.toBeInTheDocument();
  });
});
