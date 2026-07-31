import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders only when open", () => {
    const { rerender } = render(
      <Modal open={false} onClose={() => {}} title="Confirm">
        Body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <Modal open onClose={() => {}} title="Confirm">
        Body
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Confirm" })).toBeInTheDocument();
  });

  it("moves focus inside the dialog on open", () => {
    render(
      <Modal open onClose={() => {}} title="Confirm">
        <button>Save</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Confirm">
        Body
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on scrim click but not on a click inside the panel", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Confirm">
        Body
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not re-run the focus trap when onClose identity changes while open", () => {
    // Callers commonly pass an inline `onClose={() => setOpen(false)}`, which
    // is a new function on every parent re-render. The trap effect must not
    // key off that identity — otherwise it tears down/re-runs on every
    // unrelated re-render and yanks focus back to the first child.
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Confirm">
        <button>First</button>
        <button>Second</button>
      </Modal>,
    );
    const second = screen.getByText("Second");
    second.focus();
    expect(document.activeElement).toBe(second);

    rerender(
      <Modal open onClose={() => {}} title="Confirm">
        <button>First</button>
        <button>Second</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(second);
  });

  it("restores focus to the opener on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Confirm">
            <button onClick={() => setOpen(false)}>Close body</button>
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByText("Open");
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByText("Close body"));
    expect(document.activeElement).toBe(opener);
  });
});
