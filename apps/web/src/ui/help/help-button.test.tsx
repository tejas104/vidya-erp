import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HelpButton } from "./HelpButton";

describe("HelpButton", () => {
  it("renders a button with an accessible name and no panel open", () => {
    render(<HelpButton slug="attendance" />);
    expect(screen.getByRole("button", { name: /help/i })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the help panel on click", () => {
    render(<HelpButton slug="attendance" />);
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    expect(screen.getByRole("heading", { name: /marking attendance/i })).toBeVisible();
  });

  it("closes the panel on Escape (keyboard dismissal)", () => {
    render(<HelpButton slug="attendance" />);
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
