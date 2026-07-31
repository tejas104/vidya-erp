import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and body", () => {
    render(<EmptyState title="No records" body="Try a different filter." />);
    expect(screen.getByText("No records")).toBeInTheDocument();
    expect(screen.getByText("Try a different filter.")).toBeInTheDocument();
  });

  it("renders the next action as a button and fires onClick", () => {
    const onClick = vi.fn();
    render(<EmptyState title="No records" action={{ label: "Add record", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
