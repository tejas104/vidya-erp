import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import FamilyPage from "../../app/(app)/family/page";
import { AppShell } from "./AppShell";
import { api, type GuardianChild, type Session } from "./api";
import { HelpEditionProvider } from "./help/HelpEditionContext";

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
      childFees: vi.fn(),
      childNotices: vi.fn(),
      childReportCards: vi.fn(),
      childReportCardDownloadUrl: vi.fn((studentId: string, snapshotId: string) => `/children/${studentId}/${snapshotId}/download`),
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
  mocked(api.childFees).mockResolvedValue({ invoices: [] });
  mocked(api.childNotices).mockResolvedValue({ notices: [] });
  mocked(api.childReportCards).mockResolvedValue({ reportCards: [] });
});

describe("family page (ADR-0027)", () => {
  it("does not show the college marks feed beside school report cards", async () => {
    mocked(api.guardianChildren).mockResolvedValue({ children: [parentOf({ categories: ["attendance", "marks", "report-card"] })] });
    render(<HelpEditionProvider edition="school"><FamilyPage /></HelpEditionProvider>);
    expect(await screen.findByRole("heading", { name: "Report cards" })).toBeVisible();
    await waitFor(() => expect(api.childReportCards).toHaveBeenCalledWith("stu-1"));
    expect(api.childMarks).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Marks" })).not.toBeInTheDocument();
    expect(screen.queryByText("Overall marks this year")).not.toBeInTheDocument();
  });
  it("shows only published report cards for a relationship with that category", async () => {
    mocked(api.guardianChildren).mockResolvedValue({ children: [parentOf({ categories: ["report-card"] })] });
    mocked(api.childReportCards).mockResolvedValue({ reportCards: [{ snapshotId: "src_1", termId: "term_1", termName: "Term 1", academicYear: "2026-27", generatedAt: "2026-09-21T00:00:00Z", overall: { percentage: 82, grade: "A", complete: true }, attendance: { percentage: 95, complete: true } }] });
    render(<FamilyPage />);
    expect(await screen.findByText("Term 1")).toBeVisible();
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/children/stu-1/src_1/download");
    expect(api.childReportCards).toHaveBeenCalledWith("stu-1");
    expect(api.childFees).not.toHaveBeenCalled();
  });
  it("shows the child's fee balances and live notices in separate sections", async () => {
    mocked(api.guardianChildren).mockResolvedValue({ children: [parentOf({ categories: ["fees", "notices"] })] });
    mocked(api.childFees).mockResolvedValue({ invoices: [{ id: "inv_1", headName: "Tuition", academicYear: "2026-27", amountPaise: 50_000, dueOn: "2026-08-01", status: "part", paidPaise: 20_000, duesPaise: 30_000, payments: [{ receiptNo: 7, amountPaise: 20_000, mode: "upi", receivedAt: "2026-07-13T10:00:00Z" }] }] });
    mocked(api.childNotices).mockResolvedValue({ notices: [{ id: "ntc_1", kind: "notice", eventDate: null, title: "School trip", body: "Bring a water bottle.", publishAt: "2026-07-13T10:00:00Z", expiresAt: null }] });
    render(<FamilyPage />);
    expect(await screen.findByRole("heading", { name: "School notices" })).toBeVisible();
    expect(await screen.findByText("School trip")).toBeVisible();
    expect(await screen.findByText("₹300.00 due")).toBeVisible();
    expect(screen.getByText("Tuition")).toBeVisible();
    expect(api.childFees).toHaveBeenCalledWith("stu-1");
    expect(api.childNotices).toHaveBeenCalledWith("stu-1");
    expect(api.childMarks).not.toHaveBeenCalled();
  });

  it("keeps notices visible when the fee request fails", async () => {
    mocked(api.guardianChildren).mockResolvedValue({ children: [parentOf({ categories: ["fees", "notices"] })] });
    mocked(api.childFees).mockRejectedValue(new Error("offline"));
    mocked(api.childNotices).mockResolvedValue({ notices: [{ id: "ntc_1", kind: "notice", eventDate: null, title: "Sports day", body: "Tomorrow", publishAt: "2026-07-13T10:00:00Z", expiresAt: null }] });
    render(<FamilyPage />);
    expect(await screen.findByText("Sports day")).toBeVisible();
    expect(await screen.findByText("Couldn't load fees for this child.")).toBeVisible();
  });

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
