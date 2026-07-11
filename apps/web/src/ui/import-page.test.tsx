import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ImportPage from "../../app/(app)/manage/import/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, colleges: vi.fn(), createImport: vi.fn(), getImport: vi.fn() },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [{ id: "col_1", name: "Sunrise", code: "DEMO" }] });
  (api.createImport as ReturnType<typeof vi.fn>).mockResolvedValue({ importId: "imp_1" });
  (api.getImport as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "imp_1", kind: "students", collegeId: "col_1", status: "completed",
    dryRun: true, totalRows: 2, okRows: 2, errorRows: 0, errors: [],
  });
});

describe("/manage/import", () => {
  it("submits the CSV as a dry-run and shows the completed summary", async () => {
    render(<ImportPage />);
    const csv = "admission_no,full_name\nX-1,A One\nX-2,B Two";
    fireEvent.change(await screen.findByLabelText(/csv content/i), { target: { value: csv } });
    fireEvent.click(screen.getByRole("button", { name: /run import/i }));
    await waitFor(() =>
      expect(api.createImport).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "students", collegeId: "col_1", dryRun: true, csv }),
      ),
    );
    expect(await screen.findByText(/2 ok/i)).toBeInTheDocument();
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
  });
});
