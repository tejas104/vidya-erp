import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UsersPage from "../../app/(app)/manage/users/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(), listUsers: vi.fn(), createUser: vi.fn(),
      updateUser: vi.fn(), setUserRoles: vi.fn(), addGrant: vi.fn(), removeGrant: vi.fn(),
      verifyGrants: vi.fn(), passwordResetInit: vi.fn(),
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
const existing = {
  id: "u_1", username: "demo-hod-cse", displayName: "Dr. Radhika Menon", status: "active",
  collegeId: "col_1", roles: ["hod"], grants: [
    { id: "g_1", role: "hod", collegeId: "col_1", departmentId: "dep_1", classId: null, sectionId: null, subjectId: null, verified: true, source: "manual" },
  ], createdAt: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [tree.college] });
  (api.collegeTree as ReturnType<typeof vi.fn>).mockResolvedValue(tree);
  (api.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue({ users: [existing] });
  (api.createUser as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existing, id: "u_9", username: "pw.user", displayName: "PW User", status: "must_reset", roles: ["hod"], grants: [] });
});

describe("/manage/users", () => {
  it("lists users with roles and status", async () => {
    render(<UsersPage />);
    expect(await screen.findByText("demo-hod-cse")).toBeInTheDocument();
    expect(screen.getByText("Dr. Radhika Menon")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });
  it("creates a user with roles", async () => {
    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: /new user/i }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "pw.user" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "PW User" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "temp-pass-123" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /hod/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create user$/i }));
    await waitFor(() =>
      expect(api.createUser).toHaveBeenCalledWith({
        username: "pw.user", displayName: "PW User", collegeId: "col_1",
        temporaryPassword: "temp-pass-123", roles: ["hod"],
      }),
    );
  });
});
