import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DirectoryPage from "../../app/(app)/manage/directory/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, colleges: vi.fn(), collegeTree: vi.fn(), sectionRoster: vi.fn(), docList: vi.fn() },
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
    students: [{ id: "stu_1", collegeId: "col_1", admissionNo: "FYCS-001", fullName: "Aarav Sharma", status: "active", guardianName: "R. Sharma", enrollment: { sectionId: "sec_1", academicYear: "2026-27" } }],
  });
  (api.docList as ReturnType<typeof vi.fn>).mockResolvedValue({
    documents: [{ id: "doc_1", kind: "marksheet", filename: "sem1.pdf" }],
  });
});

describe("/manage/directory (accountant read-only)", () => {
  it("lists the roster and shows documents read-only — no write controls", async () => {
    render(<DirectoryPage />);
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    // read-only: none of the admin students-page write actions exist
    expect(screen.queryByRole("button", { name: /add student/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view documents/i }));
    expect(await screen.findByText("sem1.pdf")).toBeInTheDocument();
    // the document opens through the authed download link, not an editable control
    expect(screen.getByRole("link", { name: "view" })).toHaveAttribute("href", expect.stringContaining("/documents/doc_1/download"));
  });
});
