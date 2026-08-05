import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import ImportStudentsPage from "../../app/(app)/manage/import/students/page";
import ImportStaffPage from "../../app/(app)/manage/import/staff/page";
import { api, ApiError, type ImportView } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, colleges: vi.fn(), createImport: vi.fn(), getImport: vi.fn() },
  };
});

function renderStudents() {
  return render(
    <ToastProvider>
      <ImportStudentsPage />
    </ToastProvider>,
  );
}
function renderStaff() {
  return render(
    <ToastProvider>
      <ImportStaffPage />
    </ToastProvider>,
  );
}

function importView(overrides: Partial<ImportView>): ImportView {
  return {
    id: "imp_1",
    kind: "students",
    collegeId: "col_1",
    status: "completed",
    dryRun: true,
    totalRows: 3,
    okRows: 1,
    errorRows: 1,
    warningRows: 1,
    processedRows: 3,
    errors: [{ row: 3, message: "admission_no already exists" }],
    warnings: [{ row: 2, message: "created unassigned — no enrollment columns provided" }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [{ id: "col_1", name: "Sunrise", code: "DEMO" }] });
});

describe("/manage/import/students", () => {
  it("shows the template download link, scoped to kind=students", async () => {
    renderStudents();
    const link = await screen.findByRole("link", { name: /download csv template/i });
    expect(link).toHaveAttribute("href", "/api/v1/people/imports/template?kind=students");
    expect(link).toHaveAttribute("download");
  });

  it("keeps Confirm disabled until a dry-run completes, then runs the confirm pass with the same CSV", async () => {
    (api.createImport as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ importId: "imp_dry" })
      .mockResolvedValueOnce({ importId: "imp_final" });
    (api.getImport as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(importView({ id: "imp_dry", dryRun: true }))
      .mockResolvedValueOnce(importView({ id: "imp_final", dryRun: false, status: "completed" }));

    renderStudents();
    const csv = "admission_no,full_name\nA-1,One\nA-2,Two\nA-3,Three";
    fireEvent.change(await screen.findByLabelText(/csv content/i), { target: { value: csv } });

    const confirmBtn = screen.getByRole("button", { name: /confirm.*import/i });
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /preview.*dry-run/i }));
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    expect(api.createImport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "students", collegeId: "col_1", dryRun: true, csv }),
    );

    fireEvent.click(confirmBtn);
    await waitFor(() =>
      expect(api.createImport).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "students", collegeId: "col_1", dryRun: false, csv }),
      ),
    );
    // two import records, deliberately — dry run and confirm are separate audits
    expect(api.createImport).toHaveBeenCalledTimes(2);
  });

  it("distinguishes ok/warning/error rows by text (icon), never colour alone", async () => {
    (api.createImport as ReturnType<typeof vi.fn>).mockResolvedValue({ importId: "imp_dry" });
    (api.getImport as ReturnType<typeof vi.fn>).mockResolvedValue(importView({}));

    renderStudents();
    fireEvent.change(await screen.findByLabelText(/csv content/i), {
      target: { value: "admission_no,full_name\nA-1,One\nA-2,Two\nA-3,Three" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview.*dry-run/i }));

    const preview = await screen.findByTestId("import-preview");
    // all three tiers are spelled out in text — ok as a count (nothing wrong to
    // report so it never gets a row), warning/error as both a stat and a per-row badge
    expect(within(preview).getByText("ok")).toBeInTheDocument();
    expect(within(preview).getAllByText("warning").length).toBeGreaterThan(0);
    expect(within(preview).getAllByText("error").length).toBeGreaterThan(0);
    expect(within(preview).getByText(/created unassigned/i)).toBeInTheDocument();
    expect(within(preview).getByText(/admission_no already exists/i)).toBeInTheDocument();
  });

  it("flags rows withheld beyond the returned list, with a link to the full CSV once confirmed", async () => {
    (api.createImport as ReturnType<typeof vi.fn>).mockResolvedValue({ importId: "imp_final" });
    (api.getImport as ReturnType<typeof vi.fn>).mockResolvedValue(
      importView({ id: "imp_final", dryRun: false, errorRows: 5, warningRows: 0, errors: [{ row: 2, message: "boom" }], warnings: [] }),
    );

    renderStudents();
    fireEvent.change(await screen.findByLabelText(/csv content/i), { target: { value: "admission_no,full_name\nA-1,One" } });
    fireEvent.click(screen.getByRole("button", { name: /preview.*dry-run/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /confirm.*import/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /confirm.*import/i }));

    const notice = await screen.findByTestId("withheld-notice");
    expect(notice).toHaveTextContent("4 more flagged rows withheld");
    const download = screen.getByRole("link", { name: /download the error csv/i });
    expect(download).toHaveAttribute("href", "/api/v1/people/imports/imp_final/errors");
  });

  it("loading: renders neither the empty, error, denied nor ready content while colleges() is in flight", () => {
    (api.colleges as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    renderStudents();
    expect(screen.queryByText(/no college to import into/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/outside your scope/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview/i })).not.toBeInTheDocument();
  });

  it("empty: no readable college is a distinct state, not an error", async () => {
    (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [] });
    renderStudents();
    expect(await screen.findByText(/no college to import into yet/i)).toBeInTheDocument();
  });

  it("error: a failed fetch renders the error state, never collapsed into empty", async () => {
    (api.colleges as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    renderStudents();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText(/no college to import into yet/i)).not.toBeInTheDocument();
  });

  it("denied: a 403 renders DeniedState, distinct from error/empty", async () => {
    (api.colleges as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(403, "forbidden"));
    renderStudents();
    expect(await screen.findByText(/outside your scope/i)).toBeInTheDocument();
  });
});

describe("/manage/import/staff", () => {
  it("targets kind=teachers on the template link and on createImport, not a made-up 'staff' kind", async () => {
    (api.createImport as ReturnType<typeof vi.fn>).mockResolvedValue({ importId: "imp_1" });
    (api.getImport as ReturnType<typeof vi.fn>).mockResolvedValue(
      importView({ kind: "teachers", warningRows: 0, warnings: [], errorRows: 0, errors: [], okRows: 2 }),
    );

    renderStaff();
    const link = await screen.findByRole("link", { name: /download csv template/i });
    expect(link).toHaveAttribute("href", "/api/v1/people/imports/template?kind=teachers");

    fireEvent.change(await screen.findByLabelText(/csv content/i), { target: { value: "staff_no,full_name\nS-1,A\nS-2,B" } });
    fireEvent.click(screen.getByRole("button", { name: /preview.*dry-run/i }));
    await waitFor(() =>
      expect(api.createImport).toHaveBeenCalledWith(expect.objectContaining({ kind: "teachers", collegeId: "col_1", dryRun: true })),
    );
  });

  it("also keeps Confirm disabled until the staff dry-run completes", async () => {
    (api.createImport as ReturnType<typeof vi.fn>).mockResolvedValue({ importId: "imp_1" });
    (api.getImport as ReturnType<typeof vi.fn>).mockResolvedValue(
      importView({ kind: "teachers", warningRows: 0, warnings: [], errorRows: 0, errors: [] }),
    );
    renderStaff();
    fireEvent.change(await screen.findByLabelText(/csv content/i), { target: { value: "staff_no,full_name\nS-1,A" } });
    const confirmBtn = screen.getByRole("button", { name: /confirm.*import/i });
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /preview.*dry-run/i }));
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
  });

  it("denied: a 403 renders DeniedState for the staff screen too", async () => {
    (api.colleges as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(403, "forbidden"));
    renderStaff();
    expect(await screen.findByText(/outside your scope/i)).toBeInTheDocument();
  });
});
