import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OperatorDashboard } from "./OperatorDashboard";
import { syntheticTenants } from "./synthetic-tenants";

describe("operator portfolio preview", () => {
  it("finds a school, filters attention and opens an accessible detail view", () => {
    render(<OperatorDashboard tenants={syntheticTenants} />);
    expect(screen.getByRole("heading", { name: "Schools and licences" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
    expect(screen.getByRole("button", { name: "View Riverbend Academy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Greenfield School" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search schools" }), { target: { value: "northstar" } });
    fireEvent.click(screen.getByRole("button", { name: "View Northstar School" }));
    expect(screen.getByRole("dialog", { name: "Northstar School details" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains an empty filter result", () => {
    render(<OperatorDashboard tenants={[]} />);
    expect(screen.getByText("No schools match this view. Try another search or filter.")).toBeInTheDocument();
  });
});
