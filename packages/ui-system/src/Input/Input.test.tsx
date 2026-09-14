import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./Input";

describe("Input", () => {
  it("labels the control and surfaces an error", () => {
    render(<Input label="Roll no" error="Required" defaultValue="" />);
    expect(screen.getByLabelText("Roll no")).toBeInTheDocument();
    expect(screen.getByLabelText("Roll no")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Roll no")).toHaveAccessibleDescription("Required");
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
});
