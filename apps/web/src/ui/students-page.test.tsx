import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StudentsPage from "../../app/(app)/manage/students/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(), sectionRoster: vi.fn(),
      createStudent: vi.fn(), enrollStudent: vi.fn(), updateStudent: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "CS", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [{ id: "sec_1", classId: "cls_1", name: "A" }] }],
      subjects: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [tree.college] });
  (api.collegeTree as ReturnType<typeof vi.fn>).mockResolvedValue(tree);
  (api.sectionRoster as ReturnType<typeof vi.fn>).mockResolvedValue({
    students: [{ id: "stu_1", collegeId: "col_1", admissionNo: "FYCS-001", fullName: "Aarav Sharma", status: "active", enrollment: { sectionId: "sec_1", academicYear: "2026-27" } }],
  });
  (api.createStudent as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "stu_9", collegeId: "col_1", admissionNo: "FYCS-099", fullName: "New Kid", status: "active", enrollment: null });
  (api.enrollStudent as ReturnType<typeof vi.fn>).mockResolvedValue({ enrollmentId: "enr_1", previousEnrollmentId: null });
});

describe("/manage/students", () => {
  it("lists the selected section's roster", async () => {
    render(<StudentsPage />);
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("FYCS-001")).toBeInTheDocument();
  });
  it("creates then enrolls a student into the selected section", async () => {
    render(<StudentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /add student/i }));
    fireEvent.change(screen.getByLabelText("Admission no."), { target: { value: "FYCS-099" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Kid" } });
    fireEvent.click(screen.getByRole("button", { name: /^create & enroll$/i }));
    await waitFor(() =>
      expect(api.createStudent).toHaveBeenCalledWith({ collegeId: "col_1", admissionNo: "FYCS-099", fullName: "New Kid" }),
    );
    await waitFor(() =>
      expect(api.enrollStudent).toHaveBeenCalledWith("stu_9", expect.objectContaining({ sectionId: "sec_1" })),
    );
  });
});
