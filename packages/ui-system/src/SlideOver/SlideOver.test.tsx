import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SlideOver } from "./SlideOver";

describe("SlideOver", () => {
  it("renders only when open, as a labelled dialog", () => {
    const { rerender } = render(
      <SlideOver open={false} onClose={() => {}} title="Student record">
        Body
      </SlideOver>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <SlideOver open onClose={() => {}} title="Student record">
        Body
      </SlideOver>,
    );
    expect(screen.getByRole("dialog", { name: "Student record" })).toBeInTheDocument();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <SlideOver open onClose={onClose} title="Student record">
        Body
      </SlideOver>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on scrim click but not on a click inside the panel", () => {
    const onClose = vi.fn();
    render(
      <SlideOver open onClose={onClose} title="Student record">
        Body
      </SlideOver>,
    );
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus inside the dialog on open", () => {
    render(
      <SlideOver open onClose={() => {}} title="Student record">
        <button>Save</button>
      </SlideOver>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
