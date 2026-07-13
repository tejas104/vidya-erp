import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ExamsPage from "../../app/(app)/manage/exams/page";
import { api, type ExamSlotView } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(),
      exmSeries: vi.fn(), exmCreateSeries: vi.fn(), exmDeleteSeries: vi.fn(),
      exmClassSchedule: vi.fn(), exmCreateSlot: vi.fn(), exmDeleteSlot: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "CS", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [{ id: "sec_1", classId: "cls_1", name: "A" }] }],
      subjects: [{ id: "sub_1", departmentId: "dep_1", name: "Data Structures", code: "DS" }],
    },
  ],
};

function slot(over: Partial<ExamSlotView>): ExamSlotView {
  return {
    id: "slt_1", seriesId: "ser_1", seriesName: "Midterm", classId: "cls_1",
    subjectId: "sub_1", subjectName: "Data Structures",
    onDate: "2026-11-02", starts: "09:00", ends: "12:00", room: "12", ...over,
  };
}

function mock<T extends keyof typeof api>(name: T) {
  return api[name] as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mock("colleges").mockResolvedValue({ colleges: [tree.college] });
  mock("collegeTree").mockResolvedValue(tree);
  mock("exmSeries").mockResolvedValue({
    series: [{ id: "ser_1", collegeId: "col_1", name: "Midterm", academicYear: "2026-27", term: "Term 1", slotCount: 1 }],
  });
  mock("exmClassSchedule").mockResolvedValue({ slots: [slot({})] });
});

describe("/manage/exams", () => {
  it("renders the schedule and the empty state without slots", async () => {
    mock("exmClassSchedule").mockResolvedValue({ slots: [] });
    render(<ExamsPage />);
    await screen.findByText("Midterm");
    fireEvent.change(screen.getByLabelText("Class"), { target: { value: "cls_1" } });
    expect(await screen.findByText("No exams scheduled.")).toBeInTheDocument();
  });

  it("adds a paper and renders the warn badge when the response carries a clash", async () => {
    mock("exmCreateSlot").mockResolvedValue({
      ...slot({ id: "slt_2", subjectName: "Data Structures" }),
      clash: "Room 12 busy: FY CS Data Structures",
    });
    render(<ExamsPage />);
    await screen.findByText("Midterm");
    fireEvent.click(screen.getByLabelText("Select Midterm"));
    fireEvent.change(screen.getByLabelText("Class"), { target: { value: "cls_1" } });
    await screen.findByText("2026-11-02");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "sub_1" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-03" } });
    fireEvent.click(screen.getByRole("button", { name: /add paper/i }));
    await waitFor(() =>
      expect(api.exmCreateSlot).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: "ser_1", classId: "cls_1", subjectId: "sub_1", onDate: "2026-11-03" }),
      ),
    );
    expect(await screen.findByText("Room 12 busy: FY CS Data Structures")).toBeInTheDocument();
  });
});
