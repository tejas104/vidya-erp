import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage from "../../app/login/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, login: vi.fn(), logout: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
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

  it("the role toggle tailors the copy and demo prefill", () => {
    render(<LoginPage />);
    // defaults to student
    expect(screen.getByText("Student portal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use demo student login" }));
    expect(screen.getByLabelText("Username")).toHaveValue("demo-student");

    fireEvent.click(screen.getByRole("tab", { name: "Staff" }));
    expect(screen.getByText("Staff sign-in")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use demo staff login" }));
    expect(screen.getByLabelText("Username")).toHaveValue("demo-admin");
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
});
