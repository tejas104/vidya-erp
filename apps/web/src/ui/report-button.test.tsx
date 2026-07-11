import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportButton } from "./ReportButton";
import { api, type ReportParams, type ReportView } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      requestReport: vi.fn(),
      reportStatus: vi.fn(),
      downloadUrl: (id: string) => `/api/v1/reports/${id}/download`,
    },
  };
});

const params: ReportParams = { kind: "student-performance", studentId: "stu-1" };

function view(status: ReportView["status"]): ReportView {
  return { id: "rpt_abc", kind: "student-performance", format: "pdf", academicYear: "2026-27", status, rows: 3, error: null, createdAt: "2026-07-11T00:00:00Z" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReportButton (scoped generate + download)", () => {
  it("requests, polls to completion, then offers the scoped download link", async () => {
    (api.requestReport as ReturnType<typeof vi.fn>).mockResolvedValue("rpt_abc");
    (api.reportStatus as ReturnType<typeof vi.fn>).mockResolvedValue(view("completed"));

    render(<ReportButton params={params} year="2026-27" format="pdf" label="Download report (PDF)" />);
    fireEvent.click(screen.getByTestId("report-generate"));

    const link = await screen.findByTestId("report-download");
    expect(api.requestReport).toHaveBeenCalledWith(params, "pdf", "2026-27");
    // The href is the server-side scoped-download route — re-checked on the server.
    expect(link).toHaveAttribute("href", "/api/v1/reports/rpt_abc/download");
    expect(link).toHaveAttribute("download");
  });

  it("surfaces an out-of-scope failure plainly instead of a download link (403)", async () => {
    const { ApiError } = await import("./api");
    (api.requestReport as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(403, "forbidden"));

    render(<ReportButton params={params} year="2026-27" format="pdf" label="Download report (PDF)" />);
    fireEvent.click(screen.getByTestId("report-generate"));

    expect(await screen.findByText("This report is outside your scope.")).toBeInTheDocument();
    expect(screen.queryByTestId("report-download")).not.toBeInTheDocument();
  });

  it("reports a generation failure without offering a download", async () => {
    (api.requestReport as ReturnType<typeof vi.fn>).mockResolvedValue("rpt_abc");
    (api.reportStatus as ReturnType<typeof vi.fn>).mockResolvedValue(view("failed"));

    render(<ReportButton params={params} year="2026-27" format="csv" label="Export (CSV)" />);
    fireEvent.click(screen.getByTestId("report-generate"));

    expect(await screen.findByText("The report couldn't be generated.")).toBeInTheDocument();
    expect(screen.queryByTestId("report-download")).not.toBeInTheDocument();
  });
});
