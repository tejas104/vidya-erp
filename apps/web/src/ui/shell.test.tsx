import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { api } from "./api";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, logout: vi.fn().mockResolvedValue(undefined) } };
});

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-theme");
  Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  // jsdom has no matchMedia; the browser always does.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

describe("Sidebar (role-gated)", () => {
  it("shows Teaching links only for the matching role", () => {
    render(<Sidebar roles={["class_teacher"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /attendance/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /marks/i })).not.toBeInTheDocument();
  });
  it("a principal sees Dashboard but no Teaching group", () => {
    render(<Sidebar roles={["principal"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByText("Teaching")).not.toBeInTheDocument();
  });
  it("marks the current route as active", () => {
    render(<Sidebar roles={["principal"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("aria-current", "page");
  });
});

describe("Topbar", () => {
  it("toggles the theme attribute", () => {
    render(<Topbar displayName="Asha Rao" onMenu={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /asha rao/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /chalk|paper/i }));
    expect(document.documentElement.getAttribute("data-theme")).toMatch(/dark|light/);
  });
  it("signs out via the user menu", async () => {
    render(<Topbar displayName="Asha Rao" onMenu={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /asha rao/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(api.logout).toHaveBeenCalled();
  });
});
