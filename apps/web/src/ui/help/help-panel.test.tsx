import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HelpPanel } from "./HelpPanel";

describe("HelpPanel", () => {
  it("shows the doc when one exists", () => {
    render(<HelpPanel slug="attendance" open onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: /marking attendance/i })).toBeVisible();
  });

  it("shows a no-help-yet state for an unknown slug", () => {
    render(<HelpPanel slug="nope" open onClose={() => {}} />);
    expect(screen.getByText(/no help yet/i)).toBeVisible();
  });

  it("renders nothing when closed", () => {
    render(<HelpPanel slug="attendance" open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
