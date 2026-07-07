import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ManageNav } from "./ManageNav";

describe("ManageNav (role-gated)", () => {
  it("shows attendance to a class teacher and NOT admin-only links", () => {
    render(<ManageNav roles={["class_teacher"]} />);
    expect(screen.getByRole("link", { name: /attendance/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /users/i })).not.toBeInTheDocument();
  });
  it("shows marks to a teacher", () => {
    render(<ManageNav roles={["teacher"]} />);
    expect(screen.getByRole("link", { name: /marks/i })).toBeInTheDocument();
  });
  it("shows org + users to an admin", () => {
    render(<ManageNav roles={["admin"]} />);
    expect(screen.getByRole("link", { name: /users/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /organisation/i })).toBeInTheDocument();
  });
});
