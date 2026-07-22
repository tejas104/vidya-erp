import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the text label and carries data-status", () => {
    render(<StatusBadge status="good">Present</StatusBadge>);
    const badge = screen.getByText("Present");
    expect(badge).toHaveAttribute("data-status", "good");
  });

  it("still shows the text label when no icon is given (non-color signal survives)", () => {
    render(<StatusBadge status="danger">Absent</StatusBadge>);
    expect(screen.getByText("Absent")).toBeInTheDocument();
  });

  it("renders an optional icon alongside the label, not instead of it", () => {
    render(
      <StatusBadge status="warn" icon={<span data-testid="icon">!</span>}>
        Late
      </StatusBadge>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("Late")).toBeInTheDocument();
  });
});
