import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AsyncState } from "./AsyncState";
describe("AsyncState", () => {
  it("shows skeleton while loading", () => {
    render(<AsyncState loading error={false}>data</AsyncState>);
    expect(screen.queryByText("data")).not.toBeInTheDocument();
    expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument(); // skeleton
  });
  it("shows an error with a working retry", () => {
    const onRetry = vi.fn();
    render(<AsyncState loading={false} error onRetry={onRetry}>data</AsyncState>);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("shows the empty node when isEmpty, else children", () => {
    const { rerender } = render(
      <AsyncState loading={false} error={false} isEmpty empty={<div>nothing yet</div>}>rows</AsyncState>);
    expect(screen.getByText("nothing yet")).toBeInTheDocument();
    rerender(<AsyncState loading={false} error={false} isEmpty={false} empty={<div>nothing yet</div>}>rows</AsyncState>);
    expect(screen.getByText("rows")).toBeInTheDocument();
  });
});
