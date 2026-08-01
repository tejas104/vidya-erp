import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import MarksPage from "../../app/(app)/manage/marks/page";
import { api } from "./api";

function renderPage() {
  return render(
    <ToastProvider>
      <MarksPage />
    </ToastProvider>,
  );
}

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
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({
    students: [
      { id: "stu_1", fullName: "Aarav Sharma", admissionNo: "FYCS-001" },
      { id: "stu_2", fullName: "Bhavna Rao", admissionNo: "FYCS-002" },
    ],
  });
  (api.createAssessment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "as_1", classId: "cls_1", subjectId: "sub_ds", kind: "quiz", name: "Quiz 1", academicYear: "2026-27", maxScore: 10, heldOn: null });
  (api.enterMarks as ReturnType<typeof vi.fn>).mockResolvedValue({ created: 2, updated: 0, unchanged: 0 });
});

/** Create an assessment (the same flow the existing "creates an assessment" test
 * exercises) so `active` is set and the score-entry rows render. */
async function createAndOpenScoring() {
  renderPage();
  fireEvent.change(await screen.findByLabelText(/assessment name/i), { target: { value: "Quiz 1" } });
  fireEvent.click(screen.getByRole("button", { name: /create assessment/i }));
  await waitFor(() => expect(api.createAssessment).toHaveBeenCalledTimes(1));
  await screen.findByLabelText(/score for aarav sharma/i);
}

describe("marks entry", () => {
  it("creates an assessment for the caller's class+subject", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText(/assessment name/i), { target: { value: "Quiz 1" } });
    fireEvent.change(screen.getByLabelText(/max score/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /create assessment/i }));
    await waitFor(() => expect(api.createAssessment).toHaveBeenCalledTimes(1));
    const body = (api.createAssessment as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body).toMatchObject({ classId: "cls_1", subjectId: "sub_ds", name: "Quiz 1", maxScore: 10 });
  });

  it("fast entry: numeric keypad input, running progress, and Enter auto-advances to the next student", async () => {
    await createAndOpenScoring();
    expect(screen.getByText("0/2")).toBeInTheDocument();

    const first = screen.getByLabelText(/score for aarav sharma/i);
    expect(first).toHaveAttribute("inputMode", "numeric");
    fireEvent.change(first, { target: { value: "8" } });
    expect(screen.getByText("1/2")).toBeInTheDocument();

    fireEvent.keyDown(first, { key: "Enter" });
    expect(screen.getByLabelText(/score for bhavna rao/i)).toHaveFocus();
  });

  it("auto-advance behaves at the last row: Enter/ArrowDown is a no-op, no crash, focus stays put", async () => {
    await createAndOpenScoring();
    const last = screen.getByLabelText(/score for bhavna rao/i);
    last.focus();
    fireEvent.change(last, { target: { value: "5" } });
    fireEvent.keyDown(last, { key: "Enter" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(last).toHaveFocus();
  });

  it("desktop arrow-key navigation moves focus up and down between rows", async () => {
    await createAndOpenScoring();
    const first = screen.getByLabelText(/score for aarav sharma/i);
    const second = screen.getByLabelText(/score for bhavna rao/i);
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(first).toHaveFocus();
  });

  it("per-row validation: an out-of-range score shows an inline error and blocks Save; fixing it clears the error", async () => {
    await createAndOpenScoring();
    const first = screen.getByLabelText(/score for aarav sharma/i);
    fireEvent.change(first, { target: { value: "55" } }); // max is 10
    expect(await screen.findByText(/0–10 only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save marks/i })).toBeDisabled();

    fireEvent.change(first, { target: { value: "8" } });
    await waitFor(() => expect(screen.queryByText(/0–10 only/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /save marks/i })).not.toBeDisabled();
  });

  it("Save submits exactly the entered rows, in the same {studentId, score} shape as before", async () => {
    await createAndOpenScoring();
    fireEvent.change(screen.getByLabelText(/score for aarav sharma/i), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: /save marks/i }));
    await waitFor(() => expect(api.enterMarks).toHaveBeenCalledTimes(1));
    expect(api.enterMarks).toHaveBeenCalledWith("as_1", [{ studentId: "stu_1", score: 8 }]);
  });
});
