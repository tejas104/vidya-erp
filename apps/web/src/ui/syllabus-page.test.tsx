import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SyllabusPage from "../../app/(app)/manage/syllabus/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(),
      collegeTree: vi.fn(),
      dashboard: vi.fn(),
      syllabusForClass: vi.fn(),
      createUnit: vi.fn(),
      setTopicCoverage: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "CS", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [] }],
      subjects: [{ id: "sub_1", departmentId: "dep_1", name: "Data Structures", code: "DS" }],
    },
  ],
};

function mock<T extends keyof typeof api>(name: T) {
  return api[name] as unknown as ReturnType<typeof vi.fn>;
}

const editableDash = {
  academicYear: "2026-27",
  names: {},
  tiles: [{ type: "teacher-class", classId: "cls_1", subjectId: "sub_1", attendance: {}, marks: {}, atRisk: 0, strip: [] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mock("colleges").mockResolvedValue({ colleges: [tree.college] });
  mock("collegeTree").mockResolvedValue(tree);
  mock("dashboard").mockResolvedValue(editableDash);
});

describe("/manage/syllabus", () => {
  it("shows the empty state for an editable subject with no units", async () => {
    mock("syllabusForClass").mockResolvedValue({ units: [] });
    render(<SyllabusPage />);
    expect(await screen.findByText("No syllabus yet — add the first unit.")).toBeInTheDocument();
  });

  it("renders units, topics, and coverage for a loaded syllabus", async () => {
    mock("syllabusForClass").mockResolvedValue({
      units: [
        {
          id: "unit_1", classId: "cls_1", subjectId: "sub_1", subjectName: "Data Structures",
          title: "Trees", position: 0, academicYear: "2026-27", coveragePct: 50,
          topics: [
            { id: "top_1", title: "Binary trees", position: 0, taughtOn: "2026-07-01" },
            { id: "top_2", title: "AVL trees", position: 1, taughtOn: null },
          ],
        },
      ],
    });
    render(<SyllabusPage />);
    expect(await screen.findByText("Trees")).toBeInTheDocument();
    expect(screen.getByText("Binary trees")).toBeInTheDocument();
    expect(screen.getByText("AVL trees")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("marks a topic taught by calling setTopicCoverage with the chosen date", async () => {
    mock("syllabusForClass").mockResolvedValue({
      units: [
        {
          id: "unit_1", classId: "cls_1", subjectId: "sub_1", subjectName: "Data Structures",
          title: "Trees", position: 0, academicYear: "2026-27", coveragePct: 0,
          topics: [{ id: "top_2", title: "AVL trees", position: 0, taughtOn: null }],
        },
      ],
    });
    mock("setTopicCoverage").mockResolvedValue({ id: "top_2", title: "AVL trees", position: 0, taughtOn: "2026-07-10" });
    render(<SyllabusPage />);
    const input = await screen.findByLabelText("Taught date for AVL trees");
    fireEvent.change(input, { target: { value: "2026-07-10" } });
    await waitFor(() => expect(api.setTopicCoverage).toHaveBeenCalledWith("top_2", "2026-07-10"));
  });
});
