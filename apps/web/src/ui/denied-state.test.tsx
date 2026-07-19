import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeniedState } from "./DeniedState";

describe("DeniedState", () => {
  it("renders the title and message behind the denied affordance", () => {
    render(<DeniedState title="Outside your scope." message="You can't see this record." />);
    const region = screen.getByRole("alert");
    expect(region).toHaveTextContent("Outside your scope.");
    expect(region).toHaveTextContent("You can't see this record.");
    expect(region.querySelector("svg")).not.toBeNull();
  });
});
