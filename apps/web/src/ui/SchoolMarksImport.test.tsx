import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SchoolMarksImport } from "./SchoolMarksImport";
import { api, type SchoolMarkView } from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, schoolMarks: vi.fn() } };
});

const roster = [{ id: "stu_1", admissionNo: "A-1", fullName: "Asha" }];
const mark: SchoolMarkView = { id: "mark_1", assessmentId: "asm_1", studentId: "stu_1", score: 10, percentage: 50, grade: "C", points: 2, recordedBy: "teacher", updatedAt: "2026-09-25T00:00:00Z" };

function chooseCsv(csv: string) {
  const file = new File([csv], "marks.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => csv });
  fireEvent.change(screen.getByLabelText("Choose completed CSV"), { target: { files: [file] } });
}

beforeEach(() => vi.resetAllMocks());

describe("SchoolMarksImport", () => {
  it("previews a changed score, rechecks stored marks, and sends only the change", async () => {
    vi.mocked(api.schoolMarks).mockResolvedValue({ marks: [mark], termStatus: "open" });
    const onSave = vi.fn().mockResolvedValue(true);
    render(<SchoolMarksImport assessmentId="asm_1" roster={roster} marks={[mark]} maxScore={20} saving={false} onSave={onSave} />);
    chooseCsv("student_id,admission_no,student_name,score\nstu_1,A-1,Asha,12");
    expect(await screen.findByText("1 score to save")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save 1 score" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([{ studentId: "stu_1", score: 12, expectedScore: 10 }]));
    expect(api.schoolMarks).toHaveBeenCalledWith("asm_1");
  });

  it("blocks a stale preview when the score changed on the server", async () => {
    vi.mocked(api.schoolMarks).mockResolvedValue({ marks: [{ ...mark, score: 11 }], termStatus: "open" });
    const onSave = vi.fn().mockResolvedValue(true);
    render(<SchoolMarksImport assessmentId="asm_1" roster={roster} marks={[mark]} maxScore={20} saving={false} onSave={onSave} />);
    chooseCsv("student_id,admission_no,student_name,score\nstu_1,A-1,Asha,12");
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 score" }));
    expect(await screen.findByText(/Some marks changed since this preview/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
