import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

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
