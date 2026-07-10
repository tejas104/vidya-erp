import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Icon, ICON_NAMES } from "./Icon";

describe("Icon", () => {
  it("renders an aria-hidden svg for every name", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg, name).not.toBeNull();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });
});
