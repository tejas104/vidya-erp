import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Select } from "./Select";

const options = [
  { value: "a", label: "Section A" },
  { value: "b", label: "Section B" },
];

describe("Select", () => {
  it("labels the control as a combobox and surfaces an error", () => {
    render(<Select label="Section" error="Required" options={options} defaultValue="" />);
    expect(screen.getByRole("combobox", { name: "Section" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Section" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("combobox", { name: "Section" })).toHaveAccessibleDescription("Required");
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
});
