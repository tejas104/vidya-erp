import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ResultsPage from "../../app/(app)/manage/results/page";
import { api, ApiError, type StudentResult } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(),
      resScales: vi.fn(), resCreateScale: vi.fn(), resDeleteScale: vi.fn(),
      resCredits: vi.fn(), resSetCredits: vi.fn(),
      resClassResults: vi.fn(), resPublish: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "CS", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [{ id: "sec_1", classId: "cls_1", name: "A" }] }],
      subjects: [
        { id: "sub_1", departmentId: "dep_1", name: "Data Structures", code: "DS" },
        { id: "sub_2", departmentId: "dep_1", name: "Discrete Mathematics", code: "MTH" },
      ],
    },
  ],
};

const scale = {
  id: "scl_1", collegeId: "col_1", name: "10-point", locked: false,
  bands: [{ minPct: 0, grade: "F", points: 0 }, { minPct: 40, grade: "D", points: 5 }, { minPct: 90, grade: "A+", points: 10 }],
};

const alpha: StudentResult = {
  studentId: "stu_1", studentName: "Aarav Sharma", admissionNo: "FYCS-001",
  subjects: [
    { subjectId: "sub_1", subjectName: "Data Structures", credits: 4, pct: 78.5, grade: "B+", points: 8 },
    { subjectId: "sub_2", subjectName: "Discrete Mathematics", credits: 3, pct: 62, grade: "B", points: 7 },
  ],
  sgpa: 8.3, rank: 1,
};

function mock<T extends keyof typeof api>(name: T) {
  return api[name] as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mock("colleges").mockResolvedValue({ colleges: [tree.college] });
  mock("collegeTree").mockResolvedValue(tree);
  mock("resScales").mockResolvedValue({ scales: [scale] });
  mock("resClassResults").mockResolvedValue({ rows: [alpha], publications: [] });
  mock("resPublish").mockResolvedValue({
    id: "pub_1", collegeId: "col_1", classId: "cls_1", academicYear: "2026-27",
    term: "Term 1", scaleId: "scl_1", publishedAt: "2026-07-13T09:00:00Z", publishedBy: "u_adm",
  });
});

describe("/manage/results", () => {
  it("flags overlapping bands inline and blocks the save", async () => {
    render(<ResultsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /new scale/i }));
    // Default bands are valid → no error, save enabled.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Make band 1 (min 90) collide with the F band's 0.
    fireEvent.change(screen.getByLabelText("Band 1 minimum %"), { target: { value: "0" } });
    expect(await screen.findByText(/share the same minimum/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create scale/i })).toBeDisabled();
    // Remove the collision but strand the floor: no band at 0.
    fireEvent.change(screen.getByLabelText("Band 1 minimum %"), { target: { value: "95" } });
    fireEvent.change(screen.getByLabelText("Band 7 minimum %"), { target: { value: "5" } });
    expect(await screen.findByText(/one band must start at 0/)).toBeInTheDocument();
  });

  it("compiles a preview and publishes after the confirm dialog", async () => {
    render(<ResultsPage />);
    await screen.findAllByText("10-point");
    const classPickers = screen.getAllByLabelText("Class");
    fireEvent.change(classPickers[classPickers.length - 1]!, { target: { value: "cls_1" } });
    fireEvent.change(screen.getByLabelText("Grade scale"), { target: { value: "scl_1" } });
    fireEvent.click(screen.getByRole("button", { name: /compile/i }));
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("8.30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    expect(await screen.findByText(/Students see them immediately/)).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", { name: /^publish$/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    await waitFor(() =>
      expect(api.resPublish).toHaveBeenCalledWith(
        expect.objectContaining({ classId: "cls_1", scaleId: "scl_1", term: "Term 1" }),
      ),
    );
    expect(await screen.findByText("Term 1")).toBeInTheDocument();
  });

  it("shows the set-credits-first state on 422", async () => {
    mock("resClassResults").mockRejectedValue(new ApiError(422, "no credits"));
    render(<ResultsPage />);
    await screen.findAllByText("10-point");
    const classPickers = screen.getAllByLabelText("Class");
    fireEvent.change(classPickers[classPickers.length - 1]!, { target: { value: "cls_1" } });
    fireEvent.change(screen.getByLabelText("Grade scale"), { target: { value: "scl_1" } });
    fireEvent.click(screen.getByRole("button", { name: /compile/i }));
    expect(await screen.findByText("No credits set for this class.")).toBeInTheDocument();
  });

  it("loads and saves the credits grid for a class", async () => {
    mock("resCredits").mockResolvedValue({ credits: [{ subjectId: "sub_1", subjectName: "Data Structures", credits: 4 }] });
    mock("resSetCredits").mockResolvedValue({ credits: [] });
    render(<ResultsPage />);
    await screen.findAllByText("10-point");
    fireEvent.change(screen.getAllByLabelText("Class")[0]!, { target: { value: "cls_1" } });
    // Existing credits prefill; the unset subject shows 0.
    expect(await screen.findByLabelText("Data Structures credits")).toHaveValue(4);
    fireEvent.change(screen.getByLabelText("Discrete Mathematics credits"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /save credits/i }));
    await waitFor(() =>
      expect(api.resSetCredits).toHaveBeenCalledWith({
        classId: "cls_1", academicYear: expect.any(String),
        entries: [{ subjectId: "sub_1", credits: 4 }, { subjectId: "sub_2", credits: 3 }],
      }),
    );
  });
});
