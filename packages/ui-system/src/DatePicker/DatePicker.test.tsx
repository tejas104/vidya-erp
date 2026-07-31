import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DatePicker } from "./DatePicker";

describe("DatePicker", () => {
  it("renders a native date input", () => {
    render(<DatePicker label="Date" defaultValue="" />);
    expect(screen.getByLabelText("Date")).toHaveAttribute("type", "date");
  });
});
