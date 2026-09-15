import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./help-content.generated", () => ({
  HELP_DOCS: {
    college: {
      attendance: { title: "College attendance", html: "<h1>College attendance</h1>" },
      "college-only": { title: "College only", html: "<h1>College only</h1>" },
    },
    school: {
      attendance: { title: "School attendance", html: "<h1>School attendance</h1>" },
    },
  },
}));

import { HelpEditionProvider } from "./HelpEditionContext";
import { HelpPanel } from "./HelpPanel";

function show(edition: "college" | "school", slug = "attendance") {
  return render(<HelpEditionProvider edition={edition}><HelpPanel slug={slug} open onClose={() => {}} /></HelpEditionProvider>);
}

describe("HelpPanel edition selection", () => {
  it("selects the same slug from the configured runtime edition", () => {
    const { rerender } = show("school");
    expect(screen.getByRole("heading", { name: "School attendance" })).toBeVisible();
    rerender(<HelpEditionProvider edition="college"><HelpPanel slug="attendance" open onClose={() => {}} /></HelpEditionProvider>);
    expect(screen.getByRole("heading", { name: "College attendance" })).toBeVisible();
  });

  it("does not fall back to a college-only article in the school edition", () => {
    show("school", "college-only");
    expect(screen.getByText(/no help yet/i)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "College only" })).not.toBeInTheDocument();
  });
});
