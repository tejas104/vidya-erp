import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ usePathname: () => "/manage/marks" }));
import { Breadcrumbs } from "./Breadcrumbs";
it("renders derived crumbs", () => {
  render(<Breadcrumbs />);
  expect(screen.getByText("Academics")).toBeInTheDocument();
  expect(screen.getByText("Marks")).toBeInTheDocument();
});
