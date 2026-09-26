import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SchoolProgressionPage } from "./SchoolProgressionPage";
import { api, currentAcademicYear, type ProgressionPreview } from "./api";
import { HelpEditionProvider } from "./help/HelpEditionContext";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, colleges: vi.fn(), collegeTree: vi.fn(), sectionRoster: vi.fn(), schoolTerms: vi.fn(), progressionPreview: vi.fn(), progressionApply: vi.fn(), guardianHistoryPolicy: vi.fn(), updateGuardianHistoryPolicy: vi.fn() } };
});

const YEAR = currentAcademicYear();
const dateParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
const dayPart = (kind: string) => dateParts.find((item) => item.type === kind)?.value ?? "";
const TODAY = `${dayPart("year")}-${dayPart("month")}-${dayPart("day")}`;
const pupil = (id: string, fullName: string) => ({
  id, collegeId: "col_1", admissionNo: `A-${id}`, fullName, status: "active" as const, identityUserId: null, phone: null, guardianName: null, guardianPhone: null, dob: null,
  enrollment: { id: `enr_${id}`, sectionId: "sec_5a", academicYear: YEAR, startsOn: "2026-06-01", endsOn: null },
});
const previewOf = (overrides: Partial<ProgressionPreview> = {}): ProgressionPreview => ({
  sectionId: "sec_5a", academicYear: YEAR, endsOn: "2027-03-31", targetAcademicYear: "2027-28", startsOn: "2027-06-01",
  familyAccess: { liveUntil: "2027-04-01T00:00:00.000Z", historicalAccessUntil: "2027-06-30T00:00:00.000Z", days: 90, policyVersion: 1 },
  pupils: [
    { studentId: "1", admissionNo: "A-1", fullName: "Asha Rao", enrollmentId: "enr_1", outcome: "promote", statusBefore: "active", statusAfter: "active", targetSectionId: "sec_6a", reason: null, familyLinks: 0, problems: [] },
    { studentId: "2", admissionNo: "A-2", fullName: "Dev Rao", enrollmentId: "enr_2", outcome: "transfer_out", statusBefore: "active", statusAfter: "transferred", targetSectionId: null, reason: "Moved to Pune", familyLinks: 2, problems: [] },
  ],
  undecided: [{ studentId: "3", admissionNo: "A-3", fullName: "Ira Rao" }],
  problems: [],
  ready: true,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.colleges).mockResolvedValue({ colleges: [{ id: "col_1", name: "Demo School", code: "DS" }] });
  vi.mocked(api.collegeTree).mockResolvedValue({
    college: { id: "col_1", name: "Demo School", code: "DS" },
    departments: [{ id: "dep_1", collegeId: "col_1", name: "School", code: "SCH", subjects: [], classes: [
      { id: "cls_5", departmentId: "dep_1", name: "Standard 5", code: "S5", sections: [{ id: "sec_5a", classId: "cls_5", name: "A" }, { id: "sec_5b", classId: "cls_5", name: "B" }] },
      { id: "cls_6", departmentId: "dep_1", name: "Standard 6", code: "S6", sections: [{ id: "sec_6a", classId: "cls_6", name: "A" }] },
    ] }],
  });
  vi.mocked(api.sectionRoster).mockResolvedValue({ students: [pupil("1", "Asha Rao"), pupil("2", "Dev Rao"), pupil("3", "Ira Rao")] });
  vi.mocked(api.schoolTerms).mockResolvedValue({ terms: [{ id: "t2", collegeId: "col_1", name: "Term 2", academicYear: YEAR, startsOn: "2026-09-01", endsOn: "2026-12-31", status: "open", closedAt: null, closedBy: null, closedReason: null, marksReleasedAt: null }] });
  vi.mocked(api.guardianHistoryPolicy).mockResolvedValue({ days: 90, version: 1 });
});

function renderPage() {
  return render(<HelpEditionProvider edition="school"><SchoolProgressionPage /></HelpEditionProvider>);
}

describe("year-end progression page", () => {
  it("previews and records just one mid-year transfer from the exit workflow", async () => {
    const single = previewOf({
      endsOn: TODAY, targetAcademicYear: null, startsOn: null,
      familyAccess: { liveUntil: "2026-09-27T00:00:00.000Z", historicalAccessUntil: "2026-12-26T00:00:00.000Z", days: 90, policyVersion: 1 },
      pupils: [{ studentId: "2", admissionNo: "A-2", fullName: "Dev Rao", enrollmentId: "enr_2", outcome: "transfer_out", statusBefore: "active", statusAfter: "transferred", targetSectionId: null, reason: "Moved to Pune", familyLinks: 2, problems: [] }],
      undecided: [{ studentId: "1", admissionNo: "A-1", fullName: "Asha Rao" }, { studentId: "3", admissionNo: "A-3", fullName: "Ira Rao" }],
    });
    vi.mocked(api.progressionPreview).mockResolvedValue(single);
    vi.mocked(api.progressionApply).mockResolvedValue({ runId: "prg_single", preview: single, pupils: [
      { studentId: "2", outcome: "transferred_out", closedEnrollmentId: "enr_2", newEnrollmentId: null, statusBefore: "active", statusAfter: "transferred", familyAccessChanged: 2, invitationsRevoked: 1 },
    ] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "One pupil exit" }));
    await screen.findByRole("option", { name: "Dev Rao · A-2" });
    fireEvent.change(screen.getByRole("combobox", { name: "Pupil" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for leaving" }), { target: { value: "Moved to Pune" } });
    const todayLabel = new Date(`${TODAY}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    expect(screen.getByText(`${todayLabel} (today)`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview exit" }));
    await screen.findByText("Check this exit");
    expect(vi.mocked(api.progressionPreview).mock.calls[0]![0]).toMatchObject({ workflow: "single_exit", endsOn: TODAY });
    expect(vi.mocked(api.progressionPreview).mock.calls[0]![0].pupils).toEqual([
      { studentId: "2", enrollmentId: "enr_2", outcome: "transfer_out", reason: "Moved to Pune" },
    ]);
    expect(screen.getByText(/2 family links will change/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply this exit" }));
    expect(api.progressionApply).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Record exit" }));
    await waitFor(() => expect(api.progressionApply).toHaveBeenCalledWith(expect.objectContaining({
      expectedHistoryPolicyVersion: 1,
      pupils: [{ studentId: "2", enrollmentId: "enr_2", outcome: "transfer_out", reason: "Moved to Pune" }],
    })));
    expect(await screen.findByText(/The pupil's exit is recorded and audited/)).toBeInTheDocument();
    expect(api.sectionRoster).toHaveBeenCalledTimes(2);
  });

  it("warns about open terms, requires a reason for leavers, and sends exactly the chosen outcomes", async () => {
    vi.mocked(api.progressionPreview).mockResolvedValue(previewOf());
    renderPage();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Term 2 is still open");

    fireEvent.change(screen.getByRole("combobox", { name: "Outcome for Dev Rao" }), { target: { value: "transfer_out" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Outcome for Ira Rao" }), { target: { value: "undecided" } });
    expect(screen.getByText(/a reason is still missing/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for Dev Rao" }), { target: { value: "Moved to Pune" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Promote into" }), { target: { value: "sec_6a" } });
    fireEvent.change(screen.getByLabelText("New year starts"), { target: { value: "2027-06-01" } });

    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    await screen.findByText("3. Check and apply");
    const sent = vi.mocked(api.progressionPreview).mock.calls[0]![0];
    expect(sent).toMatchObject({ sectionId: "sec_5a", academicYear: YEAR, promoteToSectionId: "sec_6a", startsOn: "2027-06-01" });
    expect(sent).not.toHaveProperty("detainInSectionId");
    expect(sent.pupils).toEqual([
      { studentId: "1", enrollmentId: "enr_1", outcome: "promote" },
      { studentId: "2", enrollmentId: "enr_2", outcome: "transfer_out", reason: "Moved to Pune" },
    ]);
    expect(screen.getByText(/can read attendance and published report cards/)).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "SPAN" && element.textContent === "1 undecided, unchanged")).toBeInTheDocument();
  });

  it("applies only a clean, current preview, after confirmation", async () => {
    vi.mocked(api.progressionPreview).mockResolvedValue(previewOf());
    vi.mocked(api.progressionApply).mockResolvedValue({ runId: "prg_1", preview: previewOf(), pupils: [
      { studentId: "1", outcome: "promoted", closedEnrollmentId: "enr_1", newEnrollmentId: "enr_9", statusBefore: "active", statusAfter: "active", familyAccessChanged: 0, invitationsRevoked: 0 },
      { studentId: "2", outcome: "transferred_out", closedEnrollmentId: "enr_2", newEnrollmentId: null, statusBefore: "active", statusAfter: "transferred", familyAccessChanged: 2, invitationsRevoked: 1 },
    ] });
    renderPage();
    await screen.findByText("Asha Rao");
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    const apply = await screen.findByRole("button", { name: "Apply to 2 pupils" });

    // Changing a decision makes the preview stale: the apply step disappears.
    fireEvent.change(screen.getByRole("combobox", { name: "Outcome for Ira Rao" }), { target: { value: "graduate" } });
    expect(screen.queryByRole("button", { name: "Apply to 2 pupils" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Reason for Ira Rao" })).toBeRequired();
    fireEvent.change(screen.getByRole("combobox", { name: "Outcome for Ira Rao" }), { target: { value: "promote" } });
    fireEvent.click(await screen.findByRole("button", { name: "Apply to 2 pupils" }));
    expect(api.progressionApply).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply now" }));
    await waitFor(() => expect(api.progressionApply).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.progressionApply).mock.calls[0]![0].expectedHistoryPolicyVersion).toBe(1);
    expect(await screen.findByText(/Recorded for 2 pupils/)).toBeInTheDocument();
    expect(screen.getByText(/Transfer out\s*, 2 family links moved to read-only/)).toBeInTheDocument();
    expect(apply).toBeDefined();
  });

  it("keeps apply disabled while the preview reports problems", async () => {
    vi.mocked(api.progressionPreview).mockResolvedValue(previewOf({ ready: false, problems: ["The closing date cannot be later than today."] }));
    renderPage();
    await screen.findByText("Asha Rao");
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("The closing date cannot be later than today.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply to 2 pupils" })).toBeDisabled();
  });

  it("saves a future-exit window and clears a preview made with the old policy", async () => {
    vi.mocked(api.progressionPreview).mockResolvedValue(previewOf());
    vi.mocked(api.updateGuardianHistoryPolicy).mockResolvedValue({ days: 30, version: 2 });
    renderPage();
    await screen.findByText("Asha Rao");
    await screen.findByDisplayValue("90");
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    await screen.findByText("3. Check and apply");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Days after exit" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save window" }));
    await waitFor(() => expect(api.updateGuardianHistoryPolicy).toHaveBeenCalledWith("col_1", { days: 30, expectedVersion: 1 }));
    expect(await screen.findByText(/Existing exit dates are unchanged/)).toBeInTheDocument();
    expect(screen.queryByText("3. Check and apply")).not.toBeInTheDocument();
  });
});
