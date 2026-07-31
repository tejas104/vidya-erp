import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";

const tabs = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

describe("Tabs", () => {
  it("marks the active tab as selected via aria-selected", () => {
    render(<Tabs tabs={tabs} active="a" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "false");
  });

  it("ArrowRight moves selection to the next tab and calls onChange", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Tabs tabs={tabs} active="a" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Alpha" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("b");

    rerender(<Tabs tabs={tabs} active="b" onChange={onChange} />);
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "false");
  });

  it("uses a roving tabindex — only the active tab is tab-focusable", () => {
    render(<Tabs tabs={tabs} active="b" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("tabindex", "-1");
  });

  it("gives each tab an id and points aria-controls at its matching panel", () => {
    render(<Tabs tabs={tabs} active="a" onChange={vi.fn()} />);
    const tab = screen.getByRole("tab", { name: "Beta" });
    expect(tab).toHaveAttribute("id", "tab-b");
    expect(tab).toHaveAttribute("aria-controls", "panel-b");
  });
});
