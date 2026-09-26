import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HelpEditionProvider } from "./HelpEditionContext";
import { HelpPanel } from "./HelpPanel";

describe("HelpPanel", () => {
  it("shows the doc when one exists", () => {
    render(<HelpPanel slug="attendance" open onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: /marking attendance/i })).toBeVisible();
  });

  it("renders the compiled school article for the same slug", () => {
    render(<HelpEditionProvider edition="school"><HelpPanel slug="attendance" open onClose={() => {}} /></HelpEditionProvider>);
    expect(screen.getByRole("heading", { name: "Record school attendance" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /marking attendance/i })).not.toBeInTheDocument();
  });

  it("shows a no-help-yet state for an unknown slug", () => {
    render(<HelpPanel slug="nope" open onClose={() => {}} />);
    expect(screen.getByText(/no help yet/i)).toBeVisible();
  });

  it("shows the missing-help state for an uncovered school slug without using college content", () => {
    render(<HelpEditionProvider edition="school"><HelpPanel slug="exams" open onClose={() => {}} /></HelpEditionProvider>);
    expect(screen.getByText(/no help yet/i)).toBeVisible();
    expect(screen.queryByRole("heading", { name: /setting up exams/i })).not.toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<HelpPanel slug="attendance" open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
