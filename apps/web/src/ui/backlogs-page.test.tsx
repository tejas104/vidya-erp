import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BacklogsPage from "../../app/(app)/manage/backlogs/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, colleges: vi.fn(), collegeTree: vi.fn(), resScales: vi.fn(), resClassResults: vi.fn() },
  };
});

const subj = (subjectId: string, subjectName: string, points: number, grade: string) => ({
  subjectId, subjectName, credits: 4, pct: points === 0 ? 30 : 75, grade, points,
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [{ id: "col1", name: "Demo", code: "DEMO" }] });
  (api.collegeTree as ReturnType<typeof vi.fn>).mockResolvedValue({
    college: { id: "col1", name: "Demo", code: "DEMO" },
    departments: [{ id: "dep1", name: "CS", code: "CS", classes: [{ id: "cls1", departmentId: "dep1", name: "FY CS", code: "FYCS", sections: [] }] }],
  });
  (api.resScales as ReturnType<typeof vi.fn>).mockResolvedValue({ scales: [{ id: "sc1", collegeId: "col1", name: "10-point", bands: [] }] });
  (api.resClassResults as ReturnType<typeof vi.fn>).mockResolvedValue({
    rows: [
      // failing DS (0 points) → a backlog
      { studentId: "s1", studentName: "Rohan Deshpande", admissionNo: "FYCS-001", sgpa: 2.1, rank: 14, subjects: [subj("ds", "Data Structures", 0, "F"), subj("mth", "Maths", 7, "B")] },
      // all passing → not on the report
      { studentId: "s2", studentName: "Sanika Kulkarni", admissionNo: "FYCS-002", sgpa: 8.4, rank: 1, subjects: [subj("ds", "Data Structures", 9, "A"), subj("mth", "Maths", 8, "A")] },
    ],
    publications: [],
  });
});

describe("backlog / ATKT report", () => {
  it("lists only students carrying an F (0 grade points), with their backlog subjects", async () => {
    render(<BacklogsPage />);
    // pick a class to compile
    const classSelect = (await screen.findAllByRole("combobox"))[0]!;
    fireEvent.change(classSelect, { target: { value: "cls1" } });

    expect(await screen.findByText("Rohan Deshpande")).toBeInTheDocument();
    expect(screen.getByText("Data Structures")).toBeInTheDocument();
    // the passing student is not on the backlog report
    expect(screen.queryByText("Sanika Kulkarni")).not.toBeInTheDocument();
  });
});
