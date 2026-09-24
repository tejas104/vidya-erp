import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SchoolTermMarks } from "./SchoolTermMarks";
import { api, ApiError, type SchoolPortalMarks } from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, portalSchoolMarks: vi.fn(), childSchoolMarks: vi.fn() } };
});

const terms: SchoolPortalMarks["terms"] = [{
  termId: "term_1", termName: "Term 1", academicYear: "2026-27", endsOn: "2026-09-30", overallPct: null, complete: false,
  subjects: [{ subjectId: "math", name: "Mathematics", percentage: null, status: "incomplete", recordedCount: 1, assessmentCount: 2, assessments: [
    { assessmentId: "a1", name: "Unit 1", typeName: "Exam", heldOn: "2026-06-01", maxScore: 20, score: 16, status: "scored" },
    { assessmentId: "a2", name: "Unit 2", typeName: "Exam", heldOn: "2026-07-01", maxScore: 20, score: null, status: "missing" },
  ] }],
}, {
  termId: "term_2", termName: "Term 2", academicYear: "2026-27", endsOn: "2027-03-31", overallPct: 90, complete: true,
  subjects: [{ subjectId: "math", name: "Mathematics", percentage: 90, status: "complete", recordedCount: 2, assessmentCount: 2, assessments: [
    { assessmentId: "a1", name: "Unit 1", typeName: "Exam", heldOn: "2026-06-01", maxScore: 20, score: 16, status: "scored" },
    { assessmentId: "a2", name: "Unit 2", typeName: "Exam", heldOn: "2026-07-01", maxScore: 20, score: 20, status: "scored" },
  ] }],
}];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.portalSchoolMarks).mockResolvedValue({ terms });
  vi.mocked(api.childSchoolMarks).mockResolvedValue({ terms });
});

describe("SchoolTermMarks", () => {
  it("shows incomplete coverage and lets a student switch to a complete term", async () => {
    render(<SchoolTermMarks academicYear="2026-27" />);
    expect(await screen.findByText("1 of 2 marks recorded")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "School term marks" })).toHaveAttribute("id", "portal-marks");
    expect(screen.getByText(/missing marks are never counted as zero/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("View assessments"));
    expect(screen.getByText("16/20")).toBeInTheDocument();
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Term 2" }));
    expect(screen.getAllByText("90.00%")).toHaveLength(2);
    expect(screen.queryByText(/missing marks are never counted as zero/i)).not.toBeInTheDocument();
    expect(api.portalSchoolMarks).toHaveBeenCalledWith("2026-27");
  });

  it("hides a guardian section when the marks category is refused", async () => {
    vi.mocked(api.childSchoolMarks).mockRejectedValue(new ApiError(403, "access denied"));
    const { container } = render(<SchoolTermMarks academicYear="2026-27" studentId="stu_1" />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
    expect(api.childSchoolMarks).toHaveBeenCalledWith("stu_1", "2026-27");
  });
});
