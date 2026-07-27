import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders eyebrow, title, lede and actions", () => {
    render(<PageHeader eyebrow="Marks" title="Enter marks" lede="Pick a subject." actions={<button>New</button>} />);
    expect(screen.getByRole("heading", { name: "Enter marks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
});
