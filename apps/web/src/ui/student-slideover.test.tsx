import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StudentSlideOver, type DrawerStudent } from "./StudentSlideOver";
const stu = { studentId: "st1", name: "Asha Rao", rollNo: "23CS001", section: "A",
  initials: "AR", gradient: "", status: "active", pct: 90, attended: 9, total: 10,
  lastMark: null, backlogs: 0, flags: {}, phone: null, guardianName: null, guardianPhone: null, dob: null } as unknown as DrawerStudent;
describe("StudentSlideOver", () => {
  it("renders as a dialog with the student name and closes on Esc", () => {
    const onClose = vi.fn();
    render(<StudentSlideOver student={stu} onClose={onClose} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName(/Asha Rao/i);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("renders nothing when student is null", () => {
    render(<StudentSlideOver student={null} onClose={() => {}} />);
    // SlideOver renders through a portal to document.body, a sibling of RTL's
    // container — querying container directly is always null and proves
    // nothing. screen searches the whole document, including the portal.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("StudentSlideOver's canManage PII gate", () => {
  const stuWithPii = {
    ...stu,
    phone: "9998887776",
    guardianName: "Priya Rao",
    guardianPhone: "9990001112",
    dob: "2005-04-12",
  } as unknown as DrawerStudent;

  it("hides guardian, phone, DOB, the fees figure and the documents tab when canManage is false", () => {
    render(<StudentSlideOver student={stuWithPii} canManage={false} onClose={() => {}} />);
    expect(screen.queryByText(/Priya Rao/)).not.toBeInTheDocument();
    expect(screen.queryByText(/9998887776/)).not.toBeInTheDocument();
    expect(screen.queryByText("2005-04-12")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Fees" }));
    expect(screen.queryByRole("heading", { level: 4, name: "Fees" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Documents" }));
    expect(screen.queryByRole("heading", { level: 4, name: "Documents" })).not.toBeInTheDocument();
  });

  it("shows guardian, phone, DOB, the fees figure and the documents tab when canManage is true", () => {
    render(<StudentSlideOver student={stuWithPii} canManage onClose={() => {}} />);
    expect(screen.getByText(/Priya Rao/)).toBeInTheDocument();
    expect(screen.getByText(/9998887776/)).toBeInTheDocument();
    expect(screen.getByText("2005-04-12")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Fees" }));
    expect(screen.getByRole("heading", { level: 4, name: "Fees" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Documents" }));
    expect(screen.getByRole("heading", { level: 4, name: "Documents" })).toBeInTheDocument();
  });
});
