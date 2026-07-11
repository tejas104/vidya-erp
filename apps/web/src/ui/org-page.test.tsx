import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OrgPage from "../../app/(app)/manage/org/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(), createDepartment: vi.fn(),
      createClass: vi.fn(), createSection: vi.fn(), createSubject: vi.fn(),
      renameOrgUnit: vi.fn(), deleteOrgUnit: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "Computer Science", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [{ id: "sec_1", classId: "cls_1", name: "A" }] }],
      subjects: [{ id: "sub_1", departmentId: "dep_1", name: "Data Structures", code: "DS" }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [tree.college] });
  (api.collegeTree as ReturnType<typeof vi.fn>).mockResolvedValue(tree);
  (api.createDepartment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "dep_2", collegeId: "col_1", name: "Physics", code: "PHY" });
});

describe("/manage/org", () => {
  it("renders the tree", async () => {
    render(<OrgPage />);
    expect(await screen.findByText("Computer Science · CSE")).toBeInTheDocument();
    expect(screen.getByText("FY CS")).toBeInTheDocument();
    expect(screen.getByText("Sec A")).toBeInTheDocument();
  });
  it("creates a department with the right body", async () => {
    render(<OrgPage />);
    fireEvent.click(await screen.findByRole("button", { name: /new department/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Physics" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "PHY" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(api.createDepartment).toHaveBeenCalledWith({ collegeId: "col_1", name: "Physics", code: "PHY" }),
    );
  });
});
