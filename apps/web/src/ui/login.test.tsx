import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage, { landingFor } from "../../app/login/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, login: vi.fn(), session: vi.fn(), logout: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u_1", displayName: "Asha", roles: ["teacher"], grants: [] });
});

describe("login page", () => {
  it("submits the credentials and redirects on success", async () => {
    (api.login as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "asha" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(api.login).toHaveBeenCalledWith("asha", "secret-pass-123"));
    await waitFor(() => expect(window.location.href).toBe("/dashboard"));
  });

  it("shows a plain error on bad credentials (401)", async () => {
    const { ApiError } = await import("./api");
    (api.login as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, "no"));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/username and password don't match/i)).toBeInTheDocument();
  });

  it("uses one form for staff, students and families", () => {
    render(<LoginPage />);
    expect(screen.getByText(/Teachers, school staff, students and families use the same sign-in/)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Activate your invitation" })).toHaveAttribute("href", "/activate");
  });

  it("a local development account fills the credentials only after opening the details", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Local development accounts"));
    fireEvent.click(screen.getByRole("button", { name: "Student" }));
    expect(screen.getByLabelText("Username")).toHaveValue("demo-student");
    expect(screen.getByLabelText("Password")).toHaveValue("demo-student-pass-2026!");
  });

  it("explains a reset-required account (403)", async () => {
    const { ApiError } = await import("./api");
    (api.login as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(403, "reset"));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/password needs to be reset/i)).toBeInTheDocument();
  });

  it("sends each successful account to its server-reported workspace", () => {
    expect(landingFor({ userId: "g", kind: "guardian", displayName: "Parent", roles: [], grants: [] })).toBe("/family");
    expect(landingFor({ userId: "s", displayName: "Pupil", roles: ["student"], grants: [] })).toBe("/portal");
    expect(landingFor({ userId: "a", displayName: "Accountant", roles: ["accountant"], grants: [] })).toBe("/manage/fees");
    expect(landingFor({ userId: "t", displayName: "Teacher", roles: ["teacher"], grants: [] })).toBe("/dashboard");
  });

  it("shows and hides the password without changing the entered value", () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "school-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Password")).toHaveValue("school-secret");
  });
});
