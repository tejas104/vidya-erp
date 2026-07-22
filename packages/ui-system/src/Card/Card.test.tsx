import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders a title, actions slot, and children", () => {
    render(
      <Card title="Attendance" actions={<button>Export</button>}>
        <p>Body content</p>
      </Card>,
    );
    expect(screen.getByText("Attendance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("renders children without a header when title/actions are omitted", () => {
    render(<Card>Just content</Card>);
    expect(screen.getByText("Just content")).toBeInTheDocument();
  });
});
