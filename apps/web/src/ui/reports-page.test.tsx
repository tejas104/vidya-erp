import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import { HelpEditionProvider } from "./help/HelpEditionContext";
import ReportsPage from "../../app/(app)/manage/reports/page";
import { api } from "./api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

function renderPage(edition: "school" | "college" = "college") {
  return render(
    <HelpEditionProvider edition={edition}><ToastProvider><ReportsPage /></ToastProvider></HelpEditionProvider>,
  );
}

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, listReports: vi.fn(), session: vi.fn(), colleges: vi.fn(), collegeTree: vi.fn(), requestReport: vi.fn() },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "admin_1", displayName: "Admin", roles: ["admin"], grants: [] });
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [{ id: "col_1", name: "Vidya School" }] });
  (api.collegeTree as ReturnType<typeof vi.fn>).mockResolvedValue({ departments: [] });
  (api.requestReport as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "rpt_new", status: "pending" });
  (api.listReports as ReturnType<typeof vi.fn>).mockResolvedValue({
    reports: [
      { id: "rpt_1", kind: "student-performance", format: "pdf", academicYear: "2026-27", status: "completed", rows: 4, error: null, createdAt: "2026-07-11T05:00:00Z" },
      { id: "rpt_2", kind: "at-risk", format: "csv", academicYear: "2026-27", status: "failed", rows: 0, error: "boom", createdAt: "2026-07-11T06:00:00Z" },
    ],
  });
});

describe("/manage/reports", () => {
  it("lists reports; completed rows get a download link", async () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Back to previous section" })).toBeInTheDocument();
    expect(await screen.findByText("Student performance")).toBeInTheDocument();
    const download = screen.getByRole("link", { name: /download/i });
    expect(download).toHaveAttribute("href", "/api/v1/reports/rpt_1/download");
    // failed row shows its status, no download link for it
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /download/i })).toHaveLength(1);
  });

  it("offers a dated teacher register to school admins and derives the year from its date", async () => {
    renderPage("school");
    await screen.findByRole("option", { name: "Teacher attendance — daily register" });
    fireEvent.change(screen.getByLabelText("Report type"), { target: { value: "6" } });
    expect(screen.getByLabelText("School")).toHaveValue("col_1");
    fireEvent.change(screen.getByLabelText("Attendance date"), { target: { value: "2025-05-28" } });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "xlsx" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate report" }));
    await waitFor(() => expect(api.requestReport).toHaveBeenCalledWith(
      { kind: "teacher-attendance", collegeId: "col_1", date: "2025-05-28" }, "xlsx", "2024-25",
    ));
  });

  it("hides teacher attendance in college mode and from other school roles", async () => {
    const college = renderPage("college");
    await screen.findByText("Student performance");
    expect(screen.queryByRole("option", { name: "Teacher attendance — daily register" })).not.toBeInTheDocument();
    college.unmount();
    (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "teacher_1", displayName: "Teacher", roles: ["teacher"], grants: [] });
    renderPage("school");
    await screen.findByText("Student performance");
    await waitFor(() => expect(api.session).toHaveBeenCalled());
    expect(screen.queryByRole("option", { name: "Teacher attendance — daily register" })).not.toBeInTheDocument();
  });
});
