import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Table } from "./Table";

describe("Table", () => {
  it("sorts on header click and marks figure cells", () => {
    const onSortChange = vi.fn();
    render(
      <Table
        columns={[{ key: "roll", header: "Roll", sortable: true, figure: true }]}
        rows={[{ roll: "23CS001" }]}
        sort={{ key: "roll", dir: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Roll/ }));
    expect(onSortChange).toHaveBeenCalledWith("roll");
    expect(screen.getByText("23CS001")).toHaveAttribute("data-figure", "1");
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "ascending");
  });

  it("right-aligns a column's header and cell when align is right", () => {
    render(
      <Table
        columns={[
          { key: "name", header: "Name" },
          { key: "dues", header: "Dues", align: "right" },
        ]}
        rows={[{ name: "Asha", dues: "₹500" }]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Dues" }).className).toMatch(/right/);
    expect(screen.getByText("₹500").className).toMatch(/right/);
    expect(screen.getByRole("columnheader", { name: "Name" }).className).toBe("");
  });

  it("makes a long table a named keyboard-scrollable region", () => {
    render(<Table columns={[{ key: "name", header: "Student" }]} rows={[{ name: "Asha" }]} scrollable={{ label: "Student roster" }} />);
    expect(screen.getByRole("region", { name: "Student roster" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("table")).toContainElement(screen.getByText("Asha"));
    expect(screen.getByText("Scroll sideways to see all columns.")).toBeInTheDocument();
  });
});
