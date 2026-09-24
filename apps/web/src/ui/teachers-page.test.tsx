import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@vidya/ui-system";
import TeachersPage from "../../app/(app)/manage/teachers/page";
import { api } from "./api";

function renderPage() {
  return render(
    <ToastProvider>
      <TeachersPage />
    </ToastProvider>,
  );
}

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(), createTeacher: vi.fn(), getTeacher: vi.fn(),
      linkTeacherIdentity: vi.fn(), createTeacherAssignment: vi.fn(), removeAssignment: vi.fn(),
      classTeacherAssignments: vi.fn(), listUsers: vi.fn(), listTeachers: vi.fn(),
      updateTeacher: vi.fn(), issueTeacherCredential: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "CS", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [] }],
      subjects: [{ id: "sub_1", departmentId: "dep_1", name: "Data Structures", code: "DS" }],
    },
  ],
};
const teacher = { id: "tch_1", collegeId: "col_1", staffNo: "S-9", fullName: "New Teacher", status: "active", identityUserId: null };

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [tree.college] });
  (api.collegeTree as ReturnType<typeof vi.fn>).mockResolvedValue(tree);
  (api.classTeacherAssignments as ReturnType<typeof vi.fn>).mockResolvedValue({ assignments: [] });
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue({ users: [{ id: "u_1", username: "t.new", displayName: "T New", status: "active", accountKind: "staff", roles: ["teacher"] }] });
  (api.createTeacher as ReturnType<typeof vi.fn>).mockResolvedValue(teacher);
  (api.listTeachers as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ teachers: (api.createTeacher as ReturnType<typeof vi.fn>).mock.calls.length ? [teacher] : [], nextOffset: null }));
  (api.linkTeacherIdentity as ReturnType<typeof vi.fn>).mockResolvedValue({ teacher: { ...teacher, identityUserId: "u_1" }, grants: { upserted: 0, removed: 0 } });
  (api.updateTeacher as ReturnType<typeof vi.fn>).mockResolvedValue({ ...teacher, fullName: "Updated Teacher" });
  (api.issueTeacherCredential as ReturnType<typeof vi.fn>).mockResolvedValue({ teacher: { ...teacher, identityUserId: "u_1" }, username: "teacher-s-9", temporaryPassword: "OneTime-123", grants: { upserted: 0, removed: 0 } });
  (api.createTeacherAssignment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "asg_1", teacherId: "tch_1", classId: "cls_1", subjectId: "sub_1", kind: "subject_teacher", academicYear: "2026-27" });
});

describe("/manage/teachers", () => {
  it("creates a teacher with the college id", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Staff no."), { target: { value: "S-9" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Teacher" } });
    fireEvent.click(screen.getByRole("button", { name: /add teacher/i }));
    await waitFor(() =>
      expect(api.createTeacher).toHaveBeenCalledWith({ collegeId: "col_1", staffNo: "S-9", fullName: "New Teacher" }),
    );
    expect(await screen.findByText("New Teacher")).toBeInTheDocument();
  });
  it("assigns the created teacher as subject_teacher with a subject", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Staff no."), { target: { value: "S-9" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Teacher" } });
    fireEvent.click(screen.getByRole("button", { name: /add teacher/i }));
    fireEvent.click(await screen.findByRole("button", { name: /assign/i }));
    // modal defaults: first class, subject_teacher + first subject
    fireEvent.click(screen.getByRole("button", { name: /create assignment/i }));
    await waitFor(() =>
      expect(api.createTeacherAssignment).toHaveBeenCalledWith("tch_1", {
        classId: "cls_1",
        subjectId: "sub_1",
        kind: "subject_teacher",
        academicYear: expect.any(String),
      }),
    );
  });

  it("opens an existing teacher and issues a one-time staff sign-in", async () => {
    (api.listTeachers as ReturnType<typeof vi.fn>).mockResolvedValue({ teachers: [teacher], nextOffset: null });
    renderPage();
    expect(await screen.findByText("New Teacher")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /issue sign-in/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /issue sign-in/i }).at(-1)!);
    expect(await screen.findByText("OneTime-123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("OneTime-123")).not.toBeInTheDocument();
    expect(api.issueTeacherCredential).toHaveBeenCalledWith("tch_1");
  });

  it("updates status on a persisted teacher record", async () => {
    (api.listTeachers as ReturnType<typeof vi.fn>).mockResolvedValue({ teachers: [teacher], nextOffset: null });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "inactive" } });
    fireEvent.click(screen.getByRole("button", { name: "Save teacher" }));
    await waitFor(() => expect(api.updateTeacher).toHaveBeenCalledWith("tch_1", { fullName: "New Teacher", status: "inactive" }));
  });
});
