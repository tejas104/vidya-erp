import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import NowPage from "../../app/(app)/manage/now/page";
import { api, ApiError } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, ttMyToday: vi.fn() },
  };
});

const periods = [
  { periodNo: 1, starts: "09:00", ends: "09:50" },
  { periodNo: 2, starts: "09:50", ends: "10:40" },
];
const entry1 = {
  id: "tte_1", sectionId: "sec_1", sectionName: "A", classId: "cls_1", className: "FY CS",
  subjectId: "sub_ds", subjectName: "Data Structures", teacherId: "tch_1", teacherName: "T",
  room: "204", dayOfWeek: 5, periodNo: 1,
};
const entry2 = {
  id: "tte_2", sectionId: "sec_1", sectionName: "A", classId: "cls_1", className: "FY CS",
  subjectId: "sub_phy", subjectName: "Physics", teacherId: "tch_1", teacherName: "T",
  room: "205", dayOfWeek: 5, periodNo: 2,
};

// A fixed local instant (9:20am, mid period 1) — using the local-component
// Date constructor keeps getHours()/getMinutes() timezone-independent; only
// toISOString() (used for the href's date param) needs the runner's actual
// UTC offset, so the expected date string below is derived the same way the
// component derives it, never hardcoded.
const NOW = new Date(2026, 6, 31, 9, 20, 0);
const TODAY_ISO = NOW.toISOString().slice(0, 10);

afterEach(() => {
  vi.useRealTimers();
});

describe("/manage/now (teacher fast-path)", () => {
  it("features the in-progress period with ONE primary action wired to its section/subject/slot", async () => {
    vi.setSystemTime(NOW);
    (api.ttMyToday as ReturnType<typeof vi.fn>).mockResolvedValue({
      dayOfWeek: 5,
      periods,
      entries: [entry1, entry2],
    });
    render(<NowPage />);

    expect(await screen.findByText("Data Structures")).toBeInTheDocument();
    expect(screen.getByText("In session now")).toBeInTheDocument();
    expect(screen.getByText(/FY CS.*Sec A.*204/)).toBeInTheDocument();

    // Exactly one primary action on the whole screen.
    const links = screen.getAllByRole("link", { name: /mark attendance/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute(
      "href",
      `/manage/attendance?sectionId=sec_1&subjectId=sub_ds&slot=p1&date=${encodeURIComponent(TODAY_ISO)}`,
    );

    // The remaining period shows below, but isn't itself a second action.
    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(1);
  });

  it("features the next period as upcoming (not ongoing) before it starts", async () => {
    vi.setSystemTime(new Date(2026, 6, 31, 8, 30, 0));
    (api.ttMyToday as ReturnType<typeof vi.fn>).mockResolvedValue({
      dayOfWeek: 5,
      periods,
      entries: [entry1, entry2],
    });
    render(<NowPage />);
    expect(await screen.findByText("Data Structures")).toBeInTheDocument();
    expect(screen.getByText(/Up next · starts in 30 min/)).toBeInTheDocument();
  });

  it("says the day is done once every period has ended", async () => {
    vi.setSystemTime(new Date(2026, 6, 31, 12, 0, 0));
    (api.ttMyToday as ReturnType<typeof vi.fn>).mockResolvedValue({
      dayOfWeek: 5,
      periods,
      entries: [entry1, entry2],
    });
    render(<NowPage />);
    expect(await screen.findByText("Your teaching day is done.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /mark attendance/i })).not.toBeInTheDocument();
  });

  it("says nothing is scheduled when the college has periods but none for this teacher today", async () => {
    (api.ttMyToday as ReturnType<typeof vi.fn>).mockResolvedValue({ dayOfWeek: 5, periods, entries: [] });
    render(<NowPage />);
    expect(await screen.findByText("Nothing on your timetable today.")).toBeInTheDocument();
  });

  it("says it's a non-teaching day when dayOfWeek is 0", async () => {
    (api.ttMyToday as ReturnType<typeof vi.fn>).mockResolvedValue({ dayOfWeek: 0, periods, entries: [] });
    render(<NowPage />);
    expect(await screen.findByText("No classes today.")).toBeInTheDocument();
  });

  it("says no timetable exists when the college has no periods configured", async () => {
    (api.ttMyToday as ReturnType<typeof vi.fn>).mockResolvedValue({ dayOfWeek: 5, periods: [], entries: [] });
    render(<NowPage />);
    expect(await screen.findByText("No timetable set up yet.")).toBeInTheDocument();
  });

  it("shows the unlinked state on 404", async () => {
    (api.ttMyToday as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(404, "not linked"));
    render(<NowPage />);
    expect(await screen.findByText(/isn't linked to a teacher record/)).toBeInTheDocument();
  });

  it("shows an error state with retry on other failures", async () => {
    (api.ttMyToday as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    render(<NowPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your timetable. Try again shortly.");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
