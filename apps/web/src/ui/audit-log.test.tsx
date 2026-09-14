import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuditLog } from "./AuditLog";
import { api, ApiError } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, systemAudit: vi.fn() } };
});

beforeEach(() => { vi.resetAllMocks(); });

describe("Audit log", () => {
  it("loads real event fields, exposes details and applies an exact action filter", async () => {
    vi.mocked(api.systemAudit).mockResolvedValue({ events: [{ id: 7, occurredAt: "2026-09-14T10:00:00Z", module: "system", action: "system.clock-rollback", actorType: "system", actorId: null, resourceType: "clock", resourceId: null, requestId: "req_7", details: { reason: "clock moved backwards" } }], limit: 50, truncated: true });
    render(<AuditLog />);
    expect(await screen.findByText("system.clock-rollback")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("older events may exist");
    fireEvent.click(screen.getByLabelText("Details for event 7"));
    expect(screen.getByText(/clock moved backwards/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: " identity.login-failed " } });
    fireEvent.change(screen.getByLabelText("Event window"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    await waitFor(() => expect(api.systemAudit).toHaveBeenLastCalledWith("identity.login-failed", 100));
  });

  it("recovers from failure with retry", async () => {
    vi.mocked(api.systemAudit).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ events: [], limit: 50, truncated: false });
    render(<AuditLog />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the audit log");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No recorded events")).toBeInTheDocument();
  });

  it("shows denied access without suggesting retry", async () => {
    vi.mocked(api.systemAudit).mockRejectedValue(new ApiError(403, "forbidden"));
    render(<AuditLog />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only administrators");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
