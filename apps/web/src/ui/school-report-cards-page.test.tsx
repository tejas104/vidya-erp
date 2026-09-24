import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import { SchoolReportCardsPage } from "./SchoolReportCardsPage";
import { ApiError, api, type SchoolReportCardPreview } from "./api";
import { HelpEditionProvider } from "./help/HelpEditionContext";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, schoolReportCardDeskScope: vi.fn(), schoolReportCardRoster: vi.fn(), schoolReportCardPreview: vi.fn(), schoolGenerateReportCard: vi.fn(), schoolReportCardDownloadUrl: vi.fn((snapshotId: string) => `/api/v1/school/report-cards/${snapshotId}/download`) } };
});

const completePreview: SchoolReportCardPreview = { student: { id: "stu_1", fullName: "Meera Nair", admissionNo: "NG-001" }, term: { id: "term_1", name: "Term 1", academicYear: "2026-27", startsOn: "2026-04-01", endsOn: "2026-09-30" }, subjects: [{ subjectId: "sub_1", subjectName: "Mathematics", percentage: 82, grade: "A", complete: true }], overall: { percentage: 82, grade: "A", complete: true }, attendance: { eligibleDays: 90, presentEquivalentDays: 86, percentage: 95.6, complete: true, missingDates: [] }, warnings: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.schoolReportCardDeskScope).mockResolvedValue({ classes: [{ id: "class_1", collegeId: "col_1", name: "Class 8A" }], terms: [{ id: "term_1", collegeId: "col_1", name: "Term 1", academicYear: "2026-27" }] });
  vi.mocked(api.schoolReportCardRoster).mockResolvedValue({ students: [{ studentId: "stu_1", fullName: "Meera Nair", admissionNo: "NG-001", snapshotId: null, generatedAt: null }] });
  vi.mocked(api.schoolReportCardPreview).mockResolvedValue(completePreview);
  vi.mocked(api.schoolGenerateReportCard).mockResolvedValue({ snapshotId: "snap_1", generatedAt: "2026-09-21T00:00:00.000Z" });
  vi.mocked(api.schoolReportCardDownloadUrl).mockImplementation((snapshotId) => `/api/v1/school/report-cards/${snapshotId}/download`);
});

function renderPage() {
  return render(<HelpEditionProvider edition="school"><ToastProvider><SchoolReportCardsPage /></ToastProvider></HelpEditionProvider>);
}

async function chooseScope() {
  renderPage();
  await screen.findByRole("heading", { name: "Report card desk" });
  fireEvent.change(screen.getByLabelText("Term"), { target: { value: "term_1" } });
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "class_1" } });
  await screen.findByRole("button", { name: /Meera Nair/ });
}

async function chooseStudent() {
  await chooseScope();
  fireEvent.click(screen.getByRole("button", { name: /Meera Nair/ }));
  await screen.findByRole("button", { name: "Generate report card" });
}

describe("School report-card desk", () => {
  it("uses the scoped class choices and keeps classes from another school out of the selected term", async () => {
    vi.mocked(api.schoolReportCardDeskScope).mockResolvedValue({
      classes: [{ id: "class_1", collegeId: "col_1", name: "Class 8A" }, { id: "class_2", collegeId: "col_2", name: "Class 9B" }],
      terms: [{ id: "term_1", collegeId: "col_1", name: "Term 1", academicYear: "2026-27" }],
    });
    renderPage();
    await screen.findByRole("heading", { name: "Report card desk" });
    fireEvent.change(screen.getByLabelText("Term"), { target: { value: "term_1" } });
    expect(screen.getByRole("option", { name: "Class 8A" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Class 9B" })).not.toBeInTheDocument();
  });

  it("previews a student, generates a snapshot once, and exposes its PDF", async () => {
    await chooseStudent();
    fireEvent.click(screen.getByRole("button", { name: "Generate report card" }));
    await waitFor(() => expect(api.schoolGenerateReportCard).toHaveBeenCalledWith({ studentId: "stu_1", termId: "term_1" }));
    const download = await screen.findByRole("link", { name: "Download PDF" });
    expect(download).toHaveAttribute("href", "/api/v1/school/report-cards/snap_1/download");
    expect(screen.getByRole("button", { name: /Meera Nair/ })).toHaveTextContent("Generated");
  });

  it("keeps incomplete results explicit and requires deliberate confirmation", async () => {
    vi.mocked(api.schoolReportCardPreview).mockResolvedValue({ ...completePreview, subjects: [{ ...completePreview.subjects[0]!, percentage: null, grade: null, complete: false }], overall: { percentage: null, grade: null, complete: false }, attendance: { ...completePreview.attendance, presentEquivalentDays: null, percentage: null, complete: false, missingDates: ["2026-06-10"] }, warnings: ["Marks are still pending."] });
    await chooseStudent();
    expect(screen.getByText("Incomplete marks")).toBeVisible();
    expect(screen.getByText("Marks are still pending.")).toBeVisible();
    expect(screen.getByText("Attendance is missing for 2026-06-10.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Generate report card" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Generate with incomplete data");
    expect(api.schoolGenerateReportCard).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate with warnings" }));
    await waitFor(() => expect(api.schoolGenerateReportCard).toHaveBeenCalledTimes(1));
  });

  it("preserves the selected scope and offers preview retry after a recoverable error", async () => {
    vi.mocked(api.schoolReportCardPreview).mockRejectedValueOnce(new ApiError(500, "Preview unavailable")).mockResolvedValueOnce(completePreview);
    await chooseScope();
    fireEvent.click(screen.getByRole("button", { name: /Meera Nair/ }));
    expect(await screen.findByText("Couldn't load the preview.")).toBeVisible();
    expect(screen.getByLabelText("Term")).toHaveValue("term_1");
    expect(screen.getByLabelText("Class")).toHaveValue("class_1");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate report card" })).toBeEnabled());
    expect(api.schoolReportCardPreview).toHaveBeenCalledTimes(2);
  });

  it("prevents duplicate generation while a request is pending", async () => {
    let resolveGeneration!: (value: { snapshotId: string; generatedAt: string }) => void;
    vi.mocked(api.schoolGenerateReportCard).mockReturnValueOnce(new Promise((resolve) => { resolveGeneration = resolve; }));
    await chooseStudent();
    const generate = screen.getByRole("button", { name: "Generate report card" });
    fireEvent.click(generate);
    fireEvent.click(generate);
    expect(api.schoolGenerateReportCard).toHaveBeenCalledTimes(1);
    resolveGeneration({ snapshotId: "snap_1", generatedAt: "2026-09-21T00:00:00.000Z" });
    expect(await screen.findByRole("link", { name: "Download PDF" })).toBeVisible();
  });

  it("keeps generation disabled until the selected student's preview has loaded", async () => {
    let resolvePreview!: (value: SchoolReportCardPreview) => void;
    vi.mocked(api.schoolReportCardPreview).mockReturnValueOnce(new Promise((resolve) => { resolvePreview = resolve; }));
    await chooseScope();
    fireEvent.click(screen.getByRole("button", { name: /Meera Nair/ }));
    expect(screen.getByRole("button", { name: "Generate report card" })).toBeDisabled();
    resolvePreview(completePreview);
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate report card" })).toBeEnabled());
  });

  it("uses the school report-card article and closes help with Escape", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Help" }));
    const dialog = screen.getByRole("dialog", { name: "Help" });
    expect(within(dialog).getByRole("heading", { name: "Preparing school report cards" })).toBeVisible();
    expect(within(dialog).queryByText(/college/i)).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Help" })).not.toBeInTheDocument());
  });
});
