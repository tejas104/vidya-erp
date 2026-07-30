import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the title, a breadcrumb, and an action", () => {
    const onClick = vi.fn();
    render(
      <PageHeader
        title="Attendance"
        breadcrumb="Home / Attendance"
        actions={<button onClick={onClick}>Export</button>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Attendance" })).toBeInTheDocument();
    expect(screen.getByText("Home / Attendance")).toBeInTheDocument();
    const action = screen.getByRole("button", { name: "Export" });
    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders without breadcrumb or actions", () => {
    render(<PageHeader title="Roster" />);
    expect(screen.getByRole("heading", { level: 1, name: "Roster" })).toBeInTheDocument();
  });

  it("renders the eyebrow when passed and omits it when absent", () => {
    const { rerender } = render(<PageHeader title="Attendance" eyebrow="Attendance" />);
    expect(screen.getByText("Attendance", { selector: "p" })).toBeInTheDocument();

    rerender(<PageHeader title="Attendance" />);
    expect(screen.queryByText("Attendance", { selector: "p" })).not.toBeInTheDocument();
  });

  it("renders the lede when passed and omits it when absent", () => {
    const { rerender } = render(<PageHeader title="Attendance" lede="Track daily attendance." />);
    expect(screen.getByText("Track daily attendance.", { selector: "p" })).toBeInTheDocument();

    rerender(<PageHeader title="Attendance" />);
    expect(screen.queryByText("Track daily attendance.", { selector: "p" })).not.toBeInTheDocument();
  });
});
