import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MyTimetablePage from "../../app/(app)/manage/my-timetable/page";
import { api, ApiError } from "./api";
import { vi } from "vitest";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, ttMyWeek: vi.fn() },
  };
});

describe("/manage/my-timetable (teacher weekly grid)", () => {
  it("renders periods across multiple days in the weekly grid", async () => {
    (api.ttMyWeek as ReturnType<typeof vi.fn>).mockResolvedValue({
      periods: [
        { periodNo: 1, starts: "09:00", ends: "09:50" },
        { periodNo: 2, starts: "10:00", ends: "10:50" },
      ],
      entries: [
        { id: "tte_1", sectionId: "sec_1", sectionName: "A", classId: "cls_1", className: "FY CS", subjectId: "sub_1", subjectName: "Data Structures", teacherId: "tch_1", teacherName: "T", room: "204", dayOfWeek: 1, periodNo: 1 },
        { id: "tte_2", sectionId: "sec_1", sectionName: "A", classId: "cls_1", className: "FY CS", subjectId: "sub_2", subjectName: "Physics", teacherId: "tch_1", teacherName: "T", room: "205", dayOfWeek: 3, periodNo: 2 },
      ],
    });
    render(<MyTimetablePage />);
    expect(await screen.findByText("Data Structures")).toBeInTheDocument();
    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(screen.getAllByText("Mon").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Wed").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the empty state when nothing is scheduled", async () => {
    (api.ttMyWeek as ReturnType<typeof vi.fn>).mockResolvedValue({ periods: [{ periodNo: 1, starts: "09:00", ends: "09:50" }], entries: [] });
    render(<MyTimetablePage />);
    expect(await screen.findByText("No periods scheduled.")).toBeInTheDocument();
  });

  it("shows the unlinked state on 404", async () => {
    (api.ttMyWeek as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(404, "not linked"));
    render(<MyTimetablePage />);
    expect(await screen.findByText(/isn't linked to a teacher record/)).toBeInTheDocument();
  });

  it("shows an error state on other failures", async () => {
    (api.ttMyWeek as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    render(<MyTimetablePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your timetable. Try again shortly.");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
