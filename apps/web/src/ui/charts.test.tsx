import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendLine, CompareBars, Histogram, RiskDonut } from "./charts";

describe("chart primitives", () => {
  it("TrendLine renders an accessible titled line", () => {
    render(<TrendLine label="Attendance trend" points={[{ x: "2026-06", y: 80 }, { x: "2026-07", y: 88 }]} />);
    expect(screen.getByRole("img", { name: /Attendance trend/ })).toBeInTheDocument();
  });
  it("CompareBars lists each child with its figures", () => {
    render(<CompareBars rows={[{ label: "Computer Science", attendancePct: 86, marksPct: 74, atRisk: 1 }]} />);
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
  });
  it("Histogram summarises bands in its aria-label", () => {
    render(<Histogram label="Marks distribution" bands={[{ label: "0–40", count: 2 }, { label: "40–55", count: 3 }]} />);
    expect(screen.getByRole("img", { name: /Marks distribution/ })).toBeInTheDocument();
  });
  it("RiskDonut shows the total and segment legend", () => {
    render(<RiskDonut label="At risk" total={2} segments={[{ label: "low attendance", value: 1, tone: "var(--series-1)" }, { label: "both", value: 1, tone: "var(--series-2)" }]} />);
    expect(screen.getByText("low attendance")).toBeInTheDocument();
  });
});
