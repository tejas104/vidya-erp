import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("is decorative and hidden from assistive tech", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies width and height from props", () => {
    const { container } = render(<Skeleton width={120} height={20} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("20px");
  });
});
