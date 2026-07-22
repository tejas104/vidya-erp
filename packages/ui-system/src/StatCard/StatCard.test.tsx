import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "./StatCard";

describe("StatCard", () => {
  it("renders the label, value, and in-ring display figure", () => {
    render(<StatCard pct={72} display="72%" label="Attendance" value="26/36" />);
    expect(screen.getByText("Attendance")).toBeInTheDocument();
    expect(screen.getByText("26/36")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("renders an optional sub line when given, and omits it otherwise", () => {
    const { rerender } = render(
      <StatCard pct={50} display="50%" label="Present" value="50%" sub="last 30 days" />,
    );
    expect(screen.getByText("last 30 days")).toBeInTheDocument();
    rerender(<StatCard pct={50} display="50%" label="Present" value="50%" />);
    expect(screen.queryByText("last 30 days")).not.toBeInTheDocument();
  });

  it("hides the decorative ring svg from assistive tech", () => {
    const { container } = render(<StatCard pct={30} display="30%" label="x" value="30%" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the figures (in-ring display and meta value) in the figure font", () => {
    render(<StatCard pct={30} display="30%" label="x" value="30%" />);
    const figures = screen.getAllByText("30%");
    for (const el of figures) {
      expect(el).toHaveAttribute("data-figure", "true");
    }
  });

  it("clamps out-of-range pct without throwing", () => {
    expect(() => render(<StatCard pct={150} display="x" label="x" value="x" />)).not.toThrow();
    expect(() => render(<StatCard pct={-10} display="x" label="x" value="x" />)).not.toThrow();
  });
});
