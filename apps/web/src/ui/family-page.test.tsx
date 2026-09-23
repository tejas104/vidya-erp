import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import FamilyPage from "../../app/(app)/family/page";
import { AppShell } from "./AppShell";
import { api, type GuardianChild, type Session } from "./api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/family",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      guardianChildren: vi.fn(),
      childAttendance: vi.fn(),
      childMarks: vi.fn(),
      childToday: vi.fn(),
    },
  };
});

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const parentOf = (overrides: Partial<GuardianChild> = {}): GuardianChild => ({
  studentId: "stu-1",
  fullName: "Asha Kulkarni",
  admissionNo: "A-001",
  relationshipType: "parent",
  status: "active",
  categories: ["attendance", "marks", "timetable"],
  ...overrides,
});

const attendance = {
  counts: { present: 0, absent: 0, late: 0, excused: 0 },
  pct: null,
  monthly: [],
  sessions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked(api.childAttendance).mockResolvedValue(attendance);
  mocked(api.childMarks).mockResolvedValue({ subjects: [], overallPct: null });
  mocked(api.childToday).mockResolvedValue({ dayOfWeek: 1, periods: [], entries: [] });
});

describe("family page (ADR-0027)", () => {
  it("shows an unrecorded figure as 'Not recorded', never 0%", async () => {
    mocked(api.guardianChildren).mockResolvedValue({ children: [parentOf()] });
    render(<FamilyPage />);
    expect(await screen.findByRole("heading", { name: "Asha Kulkarni" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0));
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("Days absent")).not.toBeInTheDocument();
  });

  it("never asks for a category the relationship does not cover", async () => {
    mocked(api.guardianChildren).mockResolvedValue({
      children: [parentOf({ relationshipType: "other-authorized-contact", categories: ["attendance", "notices", "timetable"] })],
    });
    render(<FamilyPage />);
    await waitFor(() => expect(api.childAttendance).toHaveBeenCalled());
    expect(api.childMarks).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Marks" })).not.toBeInTheDocument();
  });

  it("explains a pending link instead of showing empty records", async () => {
    mocked(api.guardianChildren).mockResolvedValue({ children: [parentOf({ status: "pending" })] });
    render(<FamilyPage />);
    expect(await screen.findByText(/waiting for the school to confirm you/i)).toBeInTheDocument();
    expect(api.childAttendance).not.toHaveBeenCalled();
  });
});

describe("AppShell for a guardian session", () => {
  const guardian: Session = { userId: "g1", kind: "guardian", displayName: "Meera", roles: [], grants: [] };

  it("offers no staff rail, search or notifications", () => {
    render(<AppShell session={guardian}>x</AppShell>);
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /search/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open menu/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /vidya/i })).toHaveAttribute("href", "/family");
  });
});
