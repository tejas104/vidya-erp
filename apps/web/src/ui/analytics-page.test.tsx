import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AnalyticsPage from "../../app/(app)/manage/analytics/page";
import { api, type Dashboard, type Session } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      session: vi.fn(),
      dashboard: vi.fn(),
      rollup: vi.fn(),
      compare: vi.fn(),
      distribution: vi.fn(),
      recomputeAnalytics: vi.fn(),
    },
  };
});

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const principal: Session = {
  userId: "u-sudha",
  displayName: "Dr. Sudha Menon",
  roles: ["principal"],
  grants: [],
};
const admin: Session = { ...principal, userId: "u-admin", displayName: "Admin", roles: ["admin"] };

// A class-level focus: enough for the trend (monthly points) and — because it
// carries a classId — the distribution fetch too.
const dashboard: Dashboard = {
  academicYear: "2026-27",
  names: { "class-se-a": "SE-A" },
  tiles: [
    {
      type: "class",
      classId: "class-se-a",
      attendance: {
        state: "ok",
        value: { pct: 88, sessions: 40, distinctStudents: 30, monthly: [
          { month: "2026-07", pct: 80 }, { month: "2026-08", pct: 88 },
        ] },
      },
      marks: { state: "insufficient-cohort", minCohort: 5 },
      atRisk: 1,
      strip: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  mocked(api.session).mockResolvedValue(principal);
  mocked(api.dashboard).mockResolvedValue(dashboard);
  mocked(api.rollup).mockResolvedValue({ marks: { bySubject: [] } });
  mocked(api.compare).mockResolvedValue({ children: [], childLevel: "class" });
  // The page dereferences distribution.marks.state, so a bare {} here renders
  // nothing and fails every assertion for the wrong reason.
  mocked(api.distribution).mockResolvedValue({ marks: { state: "insufficient-cohort", minCohort: 5 } });
  mocked(api.recomputeAnalytics).mockResolvedValue(undefined);
});

describe("AnalyticsPage", () => {
  it("renders the analytics surface for an oversight role", async () => {
    render(<AnalyticsPage />);
    expect(await screen.findByRole("heading", { name: "Analytics", level: 1 })).toBeInTheDocument();
    // The trend section is what actually moved off /dashboard — assert the
    // content, not just the shell, or the split could silently render nothing.
    expect(await screen.findByRole("region", { name: "Attendance trend" })).toBeInTheDocument();
  });

  it("switches attendance between columns, line, area and exact values", async () => {
    render(<AnalyticsPage />);
    await screen.findByRole("region", { name: "Attendance trend" });
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Up 8 percentage points from Jul 2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: /Line chart of monthly attendance/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Area" }));
    expect(screen.getByRole("img", { name: /Area chart of monthly attendance/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    const values = screen.getByRole("table", { name: "Monthly attendance values" });
    expect(values).toHaveTextContent("Jul 2026");
    expect(values).toHaveTextContent("88%");
  });

  it("uses columns or values for a single recorded month", async () => {
    mocked(api.dashboard).mockResolvedValue({ ...dashboard, tiles: [{
      ...dashboard.tiles[0], attendance: { state: "ok", value: {
        pct: 88, sessions: 10, distinctStudents: 30, monthly: [{ month: "2026-08", pct: 88 }],
      } },
    }] });
    render(<AnalyticsPage />);
    await screen.findByRole("region", { name: "Attendance trend" });
    expect(screen.queryByRole("button", { name: "Line" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Area" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data" })).toBeInTheDocument();
  });

  it("derives its focus from the dashboard tiles and fetches that node's rollups", async () => {
    render(<AnalyticsPage />);
    await waitFor(() => expect(api.rollup).toHaveBeenCalled());
    expect(api.rollup).toHaveBeenCalledWith("class", "class-se-a", "2026-27");
    expect(api.compare).toHaveBeenCalledWith("class", "class-se-a", "2026-27");
    // classId present -> distribution is fetched for the class.
    expect(api.distribution).toHaveBeenCalledWith("class", "class-se-a", "2026-27");
  });

  it("keeps rendering when the optional rollup/compare/distribution fetches fail", async () => {
    mocked(api.rollup).mockRejectedValue(new Error("nope"));
    mocked(api.compare).mockRejectedValue(new Error("nope"));
    mocked(api.distribution).mockRejectedValue(new Error("nope"));
    render(<AnalyticsPage />);
    // The trend comes from the dashboard tile, so it survives all three failing.
    expect(await screen.findByRole("region", { name: "Attendance trend" })).toBeInTheDocument();
  });

  it("shows an empty state when the caller oversees nothing analysable", async () => {
    mocked(api.dashboard).mockResolvedValue({ ...dashboard, tiles: [] });
    render(<AnalyticsPage />);
    expect(await screen.findByText(/Nothing to analyse yet/i)).toBeInTheDocument();
  });

  it("offers Recompute analytics to an admin only", async () => {
    const { unmount } = render(<AnalyticsPage />);
    await screen.findByRole("heading", { name: "Analytics", level: 1 });
    // principal: no rebuild affordance
    expect(screen.queryByRole("button", { name: /recompute analytics/i })).not.toBeInTheDocument();
    unmount();

    mocked(api.session).mockResolvedValue(admin);
    render(<AnalyticsPage />);
    const button = await screen.findByRole("button", { name: /recompute analytics/i });
    fireEvent.click(button);
    await waitFor(() => expect(api.recomputeAnalytics).toHaveBeenCalledWith("2026-27"));
  });

  it("surfaces an error when the dashboard fetch fails", async () => {
    mocked(api.dashboard).mockRejectedValue(new Error("boom"));
    render(<AnalyticsPage />);
    expect(await screen.findByText(/Something went wrong loading analytics/i)).toBeInTheDocument();
  });
});
