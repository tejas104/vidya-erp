import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

beforeEach(() => localStorage.clear());

describe("Sidebar collapsible groups", () => {
  it("renders domain groups expanded by default and toggles+persists", () => {
    render(<Sidebar roles={["admin"]} open onClose={() => {}} />);
    const students = screen.getByRole("button", { name: "Students" });
    expect(students).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Students" })).toBeInTheDocument();
    fireEvent.click(students);
    expect(students).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("vidya-nav-collapsed")).toContain("STUDENTS");
  });

  it("hides a group's links once collapsed", () => {
    render(<Sidebar roles={["admin"]} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Students" }));
    expect(screen.queryByRole("link", { name: /Import Students/i })).not.toBeInTheDocument();
  });

  it("shows the human label for group headers, not the raw token", () => {
    render(<Sidebar roles={["admin"]} open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "People & comms" })).toBeInTheDocument();
    expect(screen.queryByText("PEOPLE")).not.toBeInTheDocument();
    expect(screen.queryByText("STUDENTS")).not.toBeInTheDocument();
  });

  it("renders TOP entries without a group header", () => {
    render(<Sidebar roles={["admin"]} open onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /top/i })).not.toBeInTheDocument();
  });
});
