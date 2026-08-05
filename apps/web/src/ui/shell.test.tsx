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
  it("a principal sees Dashboard but no teacher-only tools", () => {
    render(<Sidebar roles={["principal"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /my classes/i })).not.toBeInTheDocument();
  });
  it("a principal sees the read-only Syllabus link under Academics", () => {
    render(<Sidebar roles={["principal"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Academics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /syllabus/i })).toBeInTheDocument();
  });
  it("marks the current route as active", () => {
    render(<Sidebar roles={["principal"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("aria-current", "page");
  });
  it("an admin sees People (org/students/teachers/import) and Administration (users)", () => {
    render(<Sidebar roles={["admin"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "People" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Administration" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /organisation/i })).toBeInTheDocument();
    // exact names — "Students"/"Teachers" would otherwise also match the
    // Import Students/Import Staff links added below
    expect(screen.getByRole("link", { name: "Students" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Teachers" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /users/i })).toBeInTheDocument();
    // the old single "Import" entry is now two dedicated PEOPLE screens
    expect(screen.getByRole("link", { name: "Import Students" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import Staff" })).toBeInTheDocument();
  });
  it("every staff role sees Reports", () => {
    render(<Sidebar roles={["teacher"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /reports/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /users/i })).not.toBeInTheDocument();
  });
  it("a student sees only My studies (no staff rooms)", () => {
    render(<Sidebar roles={["student"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /my register/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "People" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Academics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^dashboard$/i })).not.toBeInTheDocument();
  });
  // The old "Class teacher" context badge was keyed to a "Teaching" group
  // that no longer exists post-regroup (see navConfig's ACADEMICS domain) —
  // it never fired. Removed rather than re-wired; a real class-teacher
  // context line is out of scope here.
  it("a class_teacher sees the Academics group (no 'Class teacher' affordance post-regroup)", () => {
    render(<Sidebar roles={["class_teacher"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Academics" })).toBeInTheDocument();
    expect(screen.queryByText("Class teacher")).not.toBeInTheDocument();
  });
  it("a plain teacher sees Academics but no 'Class teacher' affordance", () => {
    render(<Sidebar roles={["teacher"]} open={false} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Academics" })).toBeInTheDocument();
    expect(screen.queryByText("Class teacher")).not.toBeInTheDocument();
  });
  it("a principal (no Teaching group) sees no 'Class teacher' affordance", () => {
    render(<Sidebar roles={["principal"]} open={false} onClose={() => {}} />);
    expect(screen.queryByText("Class teacher")).not.toBeInTheDocument();
  });
});

describe("Topbar", () => {
  it("toggles the theme attribute", () => {
    render(<Topbar displayName="Asha Rao" onMenu={() => {}} onSearch={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /asha rao/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /chalk|paper/i }));
    expect(document.documentElement.getAttribute("data-theme")).toMatch(/dark|light/);
  });
  it("signs out via the user menu", async () => {
    render(<Topbar displayName="Asha Rao" onMenu={() => {}} onSearch={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /asha rao/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(api.logout).toHaveBeenCalled();
  });
});
