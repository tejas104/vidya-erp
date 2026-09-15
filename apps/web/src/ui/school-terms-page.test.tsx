import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import { SchoolTermsPage } from "./SchoolTermsPage";
import { api, type SchoolTermView } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, schoolTerms: vi.fn(), session: vi.fn(), colleges: vi.fn(), schoolCreateTerm: vi.fn(), schoolTransitionTerm: vi.fn() } };
});
const term: SchoolTermView = { id: "trm_1", collegeId: "col_1", name: "Term 1", academicYear: "2026-27", startsOn: "2026-04-01", endsOn: "2026-09-30", status: "closed", closedAt: null, closedBy: null, closedReason: "Year end" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.schoolTerms).mockResolvedValue({ terms: [term] });
  vi.mocked(api.session).mockResolvedValue({ userId: "u_1", displayName: "Admin", roles: ["admin"], grants: [] });
  vi.mocked(api.colleges).mockResolvedValue({ colleges: [{ id: "col_1", name: "Northgate School", code: "NS" }] });
});

function renderPage() { return render(<ToastProvider><SchoolTermsPage /></ToastProvider>); }

describe("School term management", () => {
  it("uses school vocabulary for Academic Year fields and removes college wording", async () => {
    vi.mocked(api.schoolTerms).mockResolvedValue({ terms: [{ ...term, status: "open" }] });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Academic Terms" })).toBeInTheDocument();
    expect(screen.getByLabelText("Academic Year")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close term" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Closing this term makes its assessment marks read-only. An administrator must reopen it with a reason before making corrections.");
    expect(screen.queryByText(/college-style marks/i)).not.toBeInTheDocument();
  });

  it("requires a reason before reopening and reflects the saved status", async () => {
    vi.mocked(api.schoolTransitionTerm).mockResolvedValue({ ...term, status: "open", closedReason: "Correction approved" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Reopen term" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Confirm reopening" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reopening reason"), { target: { value: "Correction approved" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm reopening" }));
    await waitFor(() => expect(api.schoolTransitionTerm).toHaveBeenCalledWith("trm_1", "reopen", "Correction approved"));
    expect(await screen.findByText("Open")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates a term through the API and rejects an inverted date range", async () => {
    vi.mocked(api.schoolCreateTerm).mockResolvedValue(term);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Create term" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Term name"), { target: { value: "Term 2" } });
    fireEvent.change(within(dialog).getByLabelText("Start date"), { target: { value: "2026-10-01" } });
    fireEvent.change(within(dialog).getByLabelText("End date"), { target: { value: "2026-09-01" } });
    expect(within(dialog).getByRole("button", { name: "Create term" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("End date"), { target: { value: "2027-03-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create term" }));
    await waitFor(() => expect(api.schoolCreateTerm).toHaveBeenCalledWith(expect.objectContaining({ collegeId: "col_1", name: "Term 2", startsOn: "2026-10-01", endsOn: "2027-03-31" })));
  });

  it("keeps a principal's term register read only", async () => {
    vi.mocked(api.session).mockResolvedValue({ userId: "u_2", displayName: "Principal", roles: ["principal"], grants: [] });
    renderPage();
    expect(await screen.findByText("Term 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create term" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen term" })).not.toBeInTheDocument();
  });
});
