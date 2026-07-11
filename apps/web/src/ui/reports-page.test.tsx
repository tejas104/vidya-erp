import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportsPage from "../../app/(app)/manage/reports/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, listReports: vi.fn() },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.listReports as ReturnType<typeof vi.fn>).mockResolvedValue({
    reports: [
      { id: "rpt_1", kind: "student-performance", format: "pdf", academicYear: "2026-27", status: "completed", rows: 4, error: null, createdAt: "2026-07-11T05:00:00Z" },
      { id: "rpt_2", kind: "at-risk", format: "csv", academicYear: "2026-27", status: "failed", rows: 0, error: "boom", createdAt: "2026-07-11T06:00:00Z" },
    ],
  });
});

describe("/manage/reports", () => {
  it("lists reports; completed rows get a download link", async () => {
    render(<ReportsPage />);
    expect(await screen.findByText("student-performance")).toBeInTheDocument();
    const download = screen.getByRole("link", { name: /download/i });
    expect(download).toHaveAttribute("href", "/api/v1/reports/rpt_1/download");
    // failed row shows its status, no download link for it
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /download/i })).toHaveLength(1);
  });
});
