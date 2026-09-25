import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SchoolAttendanceReviewPage } from "./SchoolAttendanceReviewPage";
import { api } from "./api";
import { HelpEditionProvider } from "./help/HelpEditionContext";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, schoolTerms: vi.fn(), schoolReportCardDeskScope: vi.fn(), colleges: vi.fn(), dashboard: vi.fn(), session: vi.fn(), schoolAttendanceShortfall: vi.fn() } };
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.schoolTerms).mockResolvedValue({ terms: [] });
  vi.mocked(api.schoolReportCardDeskScope).mockResolvedValue({ classes: [{ id: "class_1", collegeId: "col_1", name: "Standard 8", canPublish: false }], terms: [{ id: "term_2", collegeId: "col_1", name: "Term 2", academicYear: "2026-27", startsOn: "2026-09-01", endsOn: "2026-12-31" }] });
  vi.mocked(api.colleges).mockResolvedValue({ colleges: [] });
  vi.mocked(api.dashboard).mockResolvedValue({ academicYear: "2026-27", names: { class_1: "Standard 8" }, tiles: [{ type: "class", classId: "class_1", attendance: { state: "no-data" }, marks: { state: "no-data" }, atRisk: 0, strip: [{ sectionId: "section_1", name: "A", days: [] }] }] });
  vi.mocked(api.session).mockResolvedValue({ userId: "teacher_1", displayName: "Teacher", roles: ["class_teacher"], grants: [] });
  vi.mocked(api.schoolAttendanceShortfall).mockResolvedValue({ termId: "term_2", sectionId: "section_1", through: "2026-09-25", calendarVersion: 1, threshold: 75, scheduledDates: ["2026-09-21", "2026-09-22"], unsubmittedDates: ["2026-09-22"], students: [{ studentId: "student_1", fullName: "Asha Rao", admissionNo: "A-01", enrollmentDates: [{ from: "2026-09-21", to: null }], dateIssue: null, expectedDays: 2, recordedDays: 1, absentDays: 1, missingEntryDates: [], percentageDenominator: 2, percentage: null, shortfall: null }] });
});

describe("school attendance review", () => {
  it("uses class teacher scope and keeps a missing register separate from confirmed shortfall", async () => {
    render(<HelpEditionProvider edition="school"><SchoolAttendanceReviewPage /></HelpEditionProvider>);
    expect(await screen.findByRole("option", { name: "Standard 8 · A" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Term" })).toHaveValue("term_2");
    const review = screen.getByRole("button", { name: "Review attendance" });
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Needs data")).toBeInTheDocument();
    expect(screen.getByText("Enrollment dates needed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open this register →" })).toHaveAttribute("href", "/manage/attendance?sectionId=section_1&date=2026-09-22");
  });
});
