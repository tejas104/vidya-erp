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
});
