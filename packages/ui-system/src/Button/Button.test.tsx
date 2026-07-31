import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("does not fire while loading, and shows a working label", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} loading>Save</Button>);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveTextContent("Working…");
  });
  it("exposes its variant for styling hooks", () => {
    render(<Button variant="secondary">x</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-variant", "secondary");
  });
});
