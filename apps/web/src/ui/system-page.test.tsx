import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SystemPage from "../../app/(app)/manage/system/page";
import { api, type LicenseInfo } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, systemLicense: vi.fn(), systemAudit: vi.fn() } };
});

const systemLicense = api.systemLicense as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.systemAudit).mockResolvedValue({ events: [], limit: 50, truncated: false });
});

const claims = {
  id: "lic_1",
  customer: "Northgate Junior College",
  edition: "college" as const,
  issuedAt: "2026-01-01",
  expiresAt: "2026-12-31",
  seats: 1200,
};

describe("system page — every LicenseStatus variant renders, never a crash or blank", () => {
  it("shows Loading… for the licence rows before the fetch resolves", () => {
    systemLicense.mockReturnValue(new Promise(() => undefined)); // never resolves
    render(<SystemPage />);
    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });

  it("absent: a fresh install renders sensibly, not a crash or blank", async () => {
    const info: LicenseInfo = { kind: "absent", studentCount: 3 };
    systemLicense.mockResolvedValue(info);
    render(<SystemPage />);
    expect(await screen.findByText("No licence installed")).toBeInTheDocument();
    expect(screen.getByText(/3 active students \(no licence to compare against\)/)).toBeInTheDocument();
  });

  it("invalid: shows the reason, no claims fields", async () => {
    const info: LicenseInfo = { kind: "invalid", reason: "edition-mismatch", studentCount: 8 };
    systemLicense.mockResolvedValue(info);
    render(<SystemPage />);
    expect(await screen.findByText("Licence invalid (edition-mismatch)")).toBeInTheDocument();
    expect(screen.getByText(/8 active students \(licence invalid, no seat limit to compare\)/)).toBeInTheDocument();
  });

  it("valid: shows institution, edition, expiry with days remaining, and seat usage", async () => {
    const info: LicenseInfo = { kind: "valid", claims, daysRemaining: 90, studentCount: 1100 };
    systemLicense.mockResolvedValue(info);
    render(<SystemPage />);
    expect(await screen.findByText("Northgate Junior College")).toBeInTheDocument();
    expect(screen.getByText("College")).toBeInTheDocument();
    expect(screen.getByText("2026-12-31 (90 days remaining)")).toBeInTheDocument();
    expect(screen.getByText("1,100 of 1,200 licensed students")).toBeInTheDocument();
  });

  it("grace: shows days overdue, not days remaining", async () => {
    const info: LicenseInfo = { kind: "grace", claims, daysOverdue: 12, studentCount: 1200 };
    systemLicense.mockResolvedValue(info);
    render(<SystemPage />);
    expect(await screen.findByText("2026-12-31 (expired 12 days ago)")).toBeInTheDocument();
  });

  it("expired: shows days overdue", async () => {
    const info: LicenseInfo = { kind: "expired", claims, daysOverdue: 400, studentCount: 1200 };
    systemLicense.mockResolvedValue(info);
    render(<SystemPage />);
    expect(await screen.findByText("2026-12-31 (expired 400 days ago)")).toBeInTheDocument();
  });

  // The deliberately-worded seat line (task spec): over-seat is information,
  // not an alarm — same sentence shape as under-seat, no error styling.
  it("over-seat renders the exact informational sentence, not an error state", async () => {
    const info: LicenseInfo = { kind: "valid", claims, daysRemaining: 30, studentCount: 1247 };
    systemLicense.mockResolvedValue(info);
    render(<SystemPage />);
    const seatRow = await screen.findByText("1,247 of 1,200 licensed students");
    expect(seatRow.tagName).toBe("DD");
    // Plain <dd>, no inline color/style beyond the page's own default —
    // i.e. no red-alarm treatment bolted on for the over-seat case.
    expect(seatRow.getAttribute("style") ?? "").not.toMatch(/color/i);
  });

  it("a failed fetch offers a retry and keeps deployment facts available", async () => {
    systemLicense.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ kind: "absent", studentCount: 3 });
    render(<SystemPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load licence details");
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.getByText("Version")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry licence details" }));
    expect(await screen.findByText("No licence installed")).toBeInTheDocument();
  });
});
