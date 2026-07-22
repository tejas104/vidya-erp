import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

function Pusher() {
  const { push } = useToast();
  return <button onClick={() => push({ status: "good", message: "Saved" })}>go</button>;
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a pushed toast as a polite status region", () => {
    render(
      <ToastProvider>
        <Pusher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("throws if useToast is called outside a ToastProvider", () => {
    const BadConsumer = () => {
      useToast();
      return null;
    };
    expect(() => render(<BadConsumer />)).toThrow(/ToastProvider/);
  });

  it("auto-dismisses after the timer", () => {
    render(
      <ToastProvider>
        <Pusher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
