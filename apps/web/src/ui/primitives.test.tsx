import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";
import { Field } from "./Field";
import { Card } from "./Card";
import { Badge } from "./Badge";

describe("core primitives", () => {
  it("Button fires clicks, but not while loading", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} loading>Save</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1); // disabled while loading
  });
  it("Field associates label and shows an error", () => {
    render(
      <Field label="Name" htmlFor="n" error="Required">
        <input id="n" />
      </Field>,
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
  it("Card renders a title and children", () => {
    render(<Card title="Roster"><p>body</p></Card>);
    expect(screen.getByText("Roster")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
  it("Badge renders its tone", () => {
    render(<Badge tone="good">on track</Badge>);
    expect(screen.getByText("on track")).toBeInTheDocument();
  });
});
