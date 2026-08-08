import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { api, type OrgTree, type Tile, type UserView } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      prefsGet: vi.fn(),
      prefsSet: vi.fn(),
      colleges: vi.fn(),
      collegeTree: vi.fn(),
      feesHeads: vi.fn(),
      sectionRoster: vi.fn(),
      classTeacherAssignments: vi.fn(),
      getUser: vi.fn(),
    },
  };
});

function mockFn<T extends (...args: never[]) => unknown>(fn: T) {
  return fn as unknown as ReturnType<typeof vi.fn>;
}

const tree: OrgTree = {
  college: { id: "col-1", name: "Vidya College", code: "VC" },
  departments: [
    {
      id: "dept-1",
      collegeId: "col-1",
      name: "Science",
      code: "SCI",
      subjects: [],
      classes: [
        {
          id: "class-1",
          departmentId: "dept-1",
          name: "FY",
          code: "FY",
          sections: [{ id: "sec-1", classId: "class-1", name: "A" }],
        },
      ],
    },
  ],
};

const activeUser: UserView = {
  id: "u-admin",
  username: "admin",
  displayName: "Admin",
  status: "active",
  collegeId: "col-1",
  roles: ["admin"],
  grants: [],
  createdAt: "2026-01-01T00:00:00Z",
};

function freshPrefs() {
  return { key: "onboarding", value: {}, updatedAt: "2026-01-01T00:00:00Z" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFn(api.prefsGet).mockResolvedValue(freshPrefs());
  mockFn(api.prefsSet).mockResolvedValue(freshPrefs());
  mockFn(api.colleges).mockResolvedValue({ colleges: [{ id: "col-1", name: "Vidya College", code: "VC" }] });
  mockFn(api.collegeTree).mockResolvedValue(tree);
  mockFn(api.feesHeads).mockResolvedValue({ heads: [] });
  mockFn(api.sectionRoster).mockResolvedValue({ students: [] });
  mockFn(api.classTeacherAssignments).mockResolvedValue({ assignments: [] });
  mockFn(api.getUser).mockResolvedValue(activeUser);
});

describe("OnboardingChecklist — per-role item sets", () => {
  it("shows all six admin items, each deep-linking somewhere real", async () => {
    render(<OnboardingChecklist role="admin" userId="u-admin" />);
    expect(await screen.findByText("Get started")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change your password" })).toHaveAttribute("href", "/manage/users");
    expect(screen.getByRole("link", { name: "Set up your academic structure" })).toHaveAttribute(
      "href",
      "/manage/org",
    );
    expect(screen.getByRole("link", { name: "Import your students" })).toHaveAttribute(
      "href",
      "/manage/import/students",
    );
    expect(screen.getByRole("link", { name: "Import your staff" })).toHaveAttribute("href", "/manage/import/staff");
    expect(screen.getByRole("link", { name: "Set your fee structure" })).toHaveAttribute("href", "/manage/fees");
    expect(screen.getByRole("link", { name: "Print sign-in credentials" })).toHaveAttribute(
      "href",
      "/manage/classes",
    );
  });

  it("shows the three teacher items", async () => {
    render(<OnboardingChecklist role="teacher" tiles={[]} />);
    expect(await screen.findByText("Get started")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View your timetable" })).toHaveAttribute("href", "/manage/my-timetable");
    expect(screen.getByRole("link", { name: "Mark your first attendance" })).toHaveAttribute(
      "href",
      "/manage/attendance",
    );
    expect(screen.getByRole("link", { name: "Enter marks" })).toHaveAttribute("href", "/manage/marks");
  });

  it("shows the three student items, each deep-linking into the portal", async () => {
    render(<OnboardingChecklist role="student" />);
    expect(await screen.findByText("Get started")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View your attendance" })).toHaveAttribute(
      "href",
      "/portal#portal-attendance",
    );
    expect(screen.getByRole("link", { name: "View your marks" })).toHaveAttribute("href", "/portal#portal-marks");
    expect(screen.getByRole("link", { name: "View your fees" })).toHaveAttribute("href", "/portal#portal-fees");
  });
});

describe("OnboardingChecklist — auto-check", () => {
  it('"import students" is auto-checked once students already exist', async () => {
    mockFn(api.sectionRoster).mockResolvedValue({ students: [{ id: "stu-1", fullName: "Asha" }] });
    render(<OnboardingChecklist role="admin" userId="u-admin" />);
    const checkbox = await screen.findByRole("checkbox", { name: /import your students/i });
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(checkbox).toBeDisabled(); // auto-derived, not manually toggleable
  });

  it('"import students" stays unchecked when no section has a roster yet', async () => {
    render(<OnboardingChecklist role="admin" userId="u-admin" />);
    const checkbox = await screen.findByRole("checkbox", { name: /import your students/i });
    await screen.findByText("Get started");
    expect(checkbox).not.toBeChecked();
  });

  it("teacher attendance/marks auto-check from the tiles the dashboard already fetched", async () => {
    const tiles: Tile[] = [
      {
        type: "teacher-class",
        classId: "class-1",
        subjectId: "sub-1",
        attendance: { state: "ok", value: { pct: 90, sessions: 4, distinctStudents: 10, monthly: [] } },
        marks: { state: "no-data" },
        atRisk: 0,
        strip: [],
      },
    ];
    render(<OnboardingChecklist role="teacher" tiles={tiles} />);
    const attendanceBox = await screen.findByRole("checkbox", { name: /mark your first attendance/i });
    await waitFor(() => expect(attendanceBox).toBeChecked());
    const marksBox = screen.getByRole("checkbox", { name: /enter marks/i });
    expect(marksBox).not.toBeChecked();
  });
});

describe("OnboardingChecklist — persistence and dismissal", () => {
  it("a 404 (no preference written yet) is a normal first-run state, not an error", async () => {
    const { ApiError } = await import("./api");
    mockFn(api.prefsGet).mockRejectedValue(new ApiError(404, "no such preference"));
    render(<OnboardingChecklist role="student" />);
    expect(await screen.findByText("Get started")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  it("a genuine fetch failure renders an error state with retry, never an empty one", async () => {
    const { ApiError } = await import("./api");
    mockFn(api.prefsGet).mockRejectedValueOnce(new ApiError(500, "boom"));
    render(<OnboardingChecklist role="student" />);
    expect(await screen.findByText(/couldn't load your checklist/i)).toBeInTheDocument();
    expect(screen.queryByText("Get started")).not.toBeInTheDocument();

    mockFn(api.prefsGet).mockResolvedValue(freshPrefs());
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Get started")).toBeInTheDocument();
  });

  it("toggling a manual item persists the check-off via the preference store", async () => {
    render(<OnboardingChecklist role="student" />);
    const box = await screen.findByRole("checkbox", { name: "View your fees" });
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(api.prefsSet).toHaveBeenCalledWith("onboarding", { dismissed: false, checked: { fees: true } });
  });

  it("Dismiss hides the card and persists the flag, reachable via a keyboard-operable button", async () => {
    render(<OnboardingChecklist role="student" />);
    await screen.findByText("Get started");
    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissBtn);
    await waitFor(() => expect(screen.queryByText("Get started")).not.toBeInTheDocument());
    expect(api.prefsSet).toHaveBeenCalledWith("onboarding", { dismissed: true, checked: {} });
  });

  it("hides itself once every item is already checked, without needing an explicit dismiss", async () => {
    mockFn(api.prefsGet).mockResolvedValue({
      key: "onboarding",
      value: { checked: { attendance: true, marks: true, fees: true } },
      updatedAt: "2026-01-01T00:00:00Z",
    });
    render(<OnboardingChecklist role="student" />);
    await waitFor(() => expect(screen.queryByText("Get started")).not.toBeInTheDocument());
  });
});
