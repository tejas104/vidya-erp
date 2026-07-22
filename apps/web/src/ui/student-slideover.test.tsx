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
    const { container } = render(<StudentSlideOver student={null} onClose={() => {}} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
