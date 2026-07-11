import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import MarksPage from "../../app/(app)/manage/marks/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, dashboard: vi.fn(), classAssessments: vi.fn(), createAssessment: vi.fn(), sectionRoster: vi.fn(), enterMarks: vi.fn(), assessmentMarks: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.dashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
    academicYear: "2026-27",
    names: { cls_1: "FY CS", sub_ds: "Data Structures", sec_a: "A" },
    tiles: [{ type: "teacher-class", classId: "cls_1", subjectId: "sub_ds", attendance: { state: "no-data" }, marks: { state: "no-data" }, atRisk: 0, strip: [{ sectionId: "sec_a", name: "A", days: [] }] }],
  });
  (api.classAssessments as ReturnType<typeof vi.fn>).mockResolvedValue({ assessments: [] });
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({ students: [{ id: "stu_1", fullName: "Aarav Sharma", admissionNo: "FYCS-001" }] });
  (api.createAssessment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "as_1", classId: "cls_1", subjectId: "sub_ds", kind: "quiz", name: "Quiz 1", academicYear: "2026-27", maxScore: 10, heldOn: null });
  (api.enterMarks as ReturnType<typeof vi.fn>).mockResolvedValue({ created: 1, updated: 0, unchanged: 0 });
});

describe("marks entry", () => {
  it("creates an assessment for the caller's class+subject", async () => {
    render(<MarksPage />);
    fireEvent.change(await screen.findByLabelText(/assessment name/i), { target: { value: "Quiz 1" } });
    fireEvent.change(screen.getByLabelText(/max score/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /create assessment/i }));
    await waitFor(() => expect(api.createAssessment).toHaveBeenCalledTimes(1));
    const body = (api.createAssessment as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body).toMatchObject({ classId: "cls_1", subjectId: "sub_ds", name: "Quiz 1", maxScore: 10 });
  });
});
