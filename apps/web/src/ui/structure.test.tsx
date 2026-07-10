import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable, type Column } from "./DataTable";
import { PageHeader } from "./PageHeader";
import { Tabs } from "./Tabs";

interface Row { id: string; name: string; pct: number }
const columns: Column<Row>[] = [
  { key: "name", header: "Student", render: (r) => r.name },
  { key: "pct", header: "Attendance", align: "right", render: (r) => `${r.pct}%` },
];

describe("DataTable", () => {
  it("renders headers and rows", () => {
    render(
      <DataTable columns={columns} rows={[{ id: "1", name: "Aarav", pct: 61 }]} rowKey={(r) => r.id} />,
    );
    expect(screen.getByRole("columnheader", { name: "Student" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Aarav" })).toBeInTheDocument();
  });
  it("renders the empty state when there are no rows", () => {
    render(
      <DataTable columns={columns} rows={[]} rowKey={(r: Row) => r.id} empty={{ title: "No students" }} />,
    );
    expect(screen.getByText("No students")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("renders eyebrow, title, lede and actions", () => {
    render(<PageHeader eyebrow="Marks" title="Enter marks" lede="Pick a subject." actions={<button>New</button>} />);
    expect(screen.getByRole("heading", { name: "Enter marks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  it("marks the active tab and fires onChange", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} active="a" onChange={onChange} />);
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
