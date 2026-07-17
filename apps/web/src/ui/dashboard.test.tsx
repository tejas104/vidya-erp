import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "../../app/(app)/dashboard/page";
import { api, type Dashboard, type Session } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, session: vi.fn(), dashboard: vi.fn(), atRisk: vi.fn(), logout: vi.fn(), rollup: vi.fn(), compare: vi.fn(), distribution: vi.fn() },
  };
});

const session: Session = {
  userId: "u-asha",
  displayName: "Asha Rao",
  roles: ["teacher"],
  grants: [],
};

// An oversight caller (principal) gets the analytics dashboard; a teaching-only
// caller gets the focused "my day" view. Same scoped data, different surface.
const oversightSession: Session = { ...session, displayName: "Dr. Sudha Menon", roles: ["principal"] };

// A teacher who can see exactly ONE subject-class. Its marks slot is withheld
// because the cohort is under the minimum (K=5). No department/college tiles
// are returned — the server never sends what's out of scope.
const dashboard: Dashboard = {
  academicYear: "2026-27",
  names: { "class-se-a": "SE-A", "sub-ds": "Data Structures" },
  tiles: [
    {
      type: "teacher-class",
      classId: "class-se-a",
      subjectId: "sub-ds",
      attendance: { state: "ok", value: { pct: 88, sessions: 40, distinctStudents: 30, monthly: [] } },
      marks: { state: "insufficient-cohort", minCohort: 5 },
      atRisk: 1,
      strip: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  (api.session as ReturnType<typeof vi.fn>).mockResolvedValue(oversightSession);
  (api.dashboard as ReturnType<typeof vi.fn>).mockResolvedValue(dashboard);
  (api.atRisk as ReturnType<typeof vi.fn>).mockResolvedValue({
    students: [
      {
        studentId: "stu-1",
        name: "Ravi Kumar",
        attendancePct: 61,
        subjectPcts: {},
        overallPct: null,
        reasons: ["low-attendance"],
      },
    ],
  });
  (api.rollup as ReturnType<typeof vi.fn>).mockResolvedValue({
    node: { level: "class", nodeId: "class-se-a", name: "SE-A" },
    attendance: { state: "ok", value: { pct: 88, sessions: 40, distinctStudents: 30, monthly: [] } },
    marks: {
      bySubject: [
        { subjectId: "sub-ds", name: "Data Structures", summary: { state: "ok", value: { avgPct: 72, nMarks: 10, distinctStudents: 30, monthly: [] } } },
      ],
      overall: { state: "no-data" },
    },
  });
  (api.compare as ReturnType<typeof vi.fn>).mockResolvedValue({
    parent: { level: "class", nodeId: "class-se-a", name: "SE-A" },
    childLevel: "section",
    children: [
      { nodeId: "sec-a", name: "A", attendance: { state: "ok", value: { pct: 88, sessions: 40, distinctStudents: 30, monthly: [] } }, marks: { state: "no-data" }, atRisk: 1 },
    ],
  });
  (api.distribution as ReturnType<typeof vi.fn>).mockResolvedValue({
    node: { level: "class", nodeId: "class-se-a", name: "SE-A" },
    marks: { state: "insufficient-cohort", minCohort: 5 },
    attendance: { state: "ok", value: { total: 30, bands: [{ label: "75–90", count: 20 }, { label: "≥90", count: 10 }] } },
  });
});

describe("dashboard (permission mirror)", () => {
  it("renders the caller's scoped KPIs and marks-by-subject — nothing outside scope", async () => {
    render(<DashboardPage />);

    // The focus node's real attendance figure appears (KPI row + comparison bar).
    expect((await screen.findAllByText("88%")).length).toBeGreaterThanOrEqual(1);
    // …and the marks-by-subject graph is built from the scoped rollup.
    expect(screen.getByText("Data Structures")).toBeInTheDocument();
    // No out-of-scope room labels leak in (server never sent them).
    expect(screen.queryByText("Department")).not.toBeInTheDocument();
    expect(screen.queryByText("College")).not.toBeInTheDocument();
  });

  it("shows the withheld-cohort state instead of a marks figure when the cohort is under K", async () => {
    render(<DashboardPage />);
    // Appears in the KPI marks slot AND the distribution section — both withheld.
    const withheld = await screen.findAllByText(/cohort too small to summarise \(under 5\)/i);
    expect(withheld.length).toBeGreaterThanOrEqual(1);
    // Attendance, which was sufficient, still shows its real figure.
    expect(screen.getAllByText("88%").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the comparison section built from api.compare", async () => {
    render(<DashboardPage />);
    expect(await screen.findByText(/Comparison —/)).toBeInTheDocument();
  });

  it("merges at-risk students across the caller's visible nodes", async () => {
    render(<DashboardPage />);
    const link = await screen.findByRole("link", { name: "Ravi Kumar" });
    expect(link).toHaveAttribute("href", "/students/stu-1");
  });

  it("a teaching-only caller gets the focused 'my day' view, not the analytics suite", async () => {
    (api.session as ReturnType<typeof vi.fn>).mockResolvedValue(session);
    render(<DashboardPage />);
    // The at-risk student still surfaces under Needs attention…
    const link = await screen.findByRole("link", { name: "Ravi Kumar" });
    expect(link).toHaveAttribute("href", "/students/stu-1");
    // …the scoped attendance figure shows in the stat strip…
    expect(screen.getAllByText("88%").length).toBeGreaterThanOrEqual(1);
    // …and the oversight analytics do NOT appear on a teacher's dashboard.
    expect(screen.queryByText(/Comparison —/)).not.toBeInTheDocument();
    expect(screen.queryByText("Marks by subject")).not.toBeInTheDocument();
  });

  it("redirects to /login when the session is unauthenticated (401)", async () => {
    const { ApiError } = await import("./api");
    (api.session as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, "no session"));
    render(<DashboardPage />);
    await waitFor(() => expect(window.location.href).toBe("/login"));
  });
});
