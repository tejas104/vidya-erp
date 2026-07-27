import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("core primitives", () => {
  it("Badge renders its tone", () => {
    render(<Badge tone="good">on track</Badge>);
    expect(screen.getByText("on track")).toBeInTheDocument();
  });
});
