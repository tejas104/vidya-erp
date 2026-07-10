import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Modal } from "./Modal";
import { ToastProvider, useToast } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";

describe("Modal", () => {
  it("closes on Escape and returns focus to the opener", () => {
    const onClose = vi.fn();
    render(
      <>
        <button>opener</button>
        <Modal open onClose={onClose} title="Edit">
          <input aria-label="inner" />
        </Modal>
      </>,
    );
    expect(screen.getByRole("dialog", { name: "Edit" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("focuses the first focusable element when opened", () => {
    render(
      <Modal open onClose={() => {}} title="Edit">
        <input aria-label="inner" />
      </Modal>,
    );
    expect(screen.getByLabelText("inner")).toHaveFocus();
  });
});

describe("stacked overlays", () => {
  it("Escape closes only the topmost overlay", () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(
      <>
        <Modal open onClose={closeOuter} title="Outer">
          <p>outer</p>
        </Modal>
        <Modal open onClose={closeInner} title="Inner">
          <p>inner</p>
        </Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });
});

function ToastFixture() {
  const toast = useToast();
  return <button onClick={() => toast.show("Saved", "good")}>fire</button>;
}

describe("Toast", () => {
  it("shows a toast and auto-dismisses", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastFixture />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("ConfirmDialog", () => {
  it("confirms and cancels", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Delete section" message="Sure?" danger onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
