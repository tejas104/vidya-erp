import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LicenseBanner } from "./LicenseBanner";
import { api, type LicenseInfo, type Role } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, systemLicense: vi.fn() } };
});

const systemLicense = api.systemLicense as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

const claims = {
  id: "lic_1",
  customer: "Northgate Junior College",
  edition: "college" as const,
  issuedAt: "2026-01-01",
  expiresAt: "2026-12-31",
  seats: 500,
};

const STATES: Record<string, LicenseInfo> = {
  farFromExpiry: { kind: "valid", claims, daysRemaining: 90, studentCount: 400 },
  within30Days: { kind: "valid", claims, daysRemaining: 20, studentCount: 400 },
  within7Days: { kind: "valid", claims, daysRemaining: 5, studentCount: 400 },
  grace: { kind: "grace", claims, daysOverdue: 10, studentCount: 400 },
  expired: { kind: "expired", claims, daysOverdue: 45, studentCount: 400 },
  invalid: { kind: "invalid", reason: "bad-signature", studentCount: 400 },
  absent: { kind: "absent", studentCount: 400 },
};

/** No banner text of any kind ever renders — the only reliable negative
 * assertion, since the messages vary by state. */
async function expectNoBanner() {
  // Let any pending fetch/effect flush before asserting absence.
  await Promise.resolve();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
}

const STAFF_NON_ADMIN: Role[] = ["principal", "hod", "class_teacher", "teacher", "accountant"];

describe("LicenseBanner — student never sees any state", () => {
  it("never fetches license status for a student session", async () => {
    render(<LicenseBanner roles={["student"]} />);
    await expectNoBanner();
    expect(systemLicense).not.toHaveBeenCalled();
  });

  it.each(Object.keys(STATES))("renders nothing for a student even if the API answers (%s)", async (key) => {
    systemLicense.mockResolvedValue(STATES[key]);
    render(<LicenseBanner roles={["student"]} />);
    await expectNoBanner();
  });
});

describe("LicenseBanner — admin sees every state per the spec table", () => {
  it("shows nothing when more than 30 days remain", async () => {
    systemLicense.mockResolvedValue(STATES.farFromExpiry);
    render(<LicenseBanner roles={["admin"]} />);
    await expectNoBanner();
  });

  it("shows a warning at <=30 days remaining", async () => {
    systemLicense.mockResolvedValue(STATES.within30Days);
    render(<LicenseBanner roles={["admin"]} />);
    expect(await screen.findByText(/expires in 20 days/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an urgent warning at <=7 days remaining", async () => {
    systemLicense.mockResolvedValue(STATES.within7Days);
    render(<LicenseBanner roles={["admin"]} />);
    expect(await screen.findByText(/expires in 5 days/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows a persistent notice once expired (grace)", async () => {
    systemLicense.mockResolvedValue(STATES.grace);
    render(<LicenseBanner roles={["admin"]} />);
    expect(await screen.findByText(/expired 10 days ago/)).toBeInTheDocument();
  });

  it("shows a persistent notice once expired (past grace)", async () => {
    systemLicense.mockResolvedValue(STATES.expired);
    render(<LicenseBanner roles={["admin"]} />);
    expect(await screen.findByText(/expired 45 days ago/)).toBeInTheDocument();
  });

  it("shows a persistent notice for an invalid licence", async () => {
    systemLicense.mockResolvedValue(STATES.invalid);
    render(<LicenseBanner roles={["admin"]} />);
    expect(await screen.findByText(/Licence problem \(bad-signature\)/)).toBeInTheDocument();
  });

  it("shows a persistent notice for an absent licence", async () => {
    systemLicense.mockResolvedValue(STATES.absent);
    render(<LicenseBanner roles={["admin"]} />);
    expect(await screen.findByText(/No licence installed/)).toBeInTheDocument();
  });
});

describe("LicenseBanner — non-admin staff see only the <=7-day warning", () => {
  it.each(STAFF_NON_ADMIN)("%s sees the <=7-day warning", async (role) => {
    systemLicense.mockResolvedValue(STATES.within7Days);
    render(<LicenseBanner roles={[role]} />);
    expect(await screen.findByText(/expires in 5 days/)).toBeInTheDocument();
  });

  it.each(STAFF_NON_ADMIN)("%s never sees the <=30-day (admin-only) warning", async (role) => {
    systemLicense.mockResolvedValue(STATES.within30Days);
    render(<LicenseBanner roles={[role]} />);
    await expectNoBanner();
  });

  it.each(STAFF_NON_ADMIN)("%s never sees an expired notice", async (role) => {
    systemLicense.mockResolvedValue(STATES.expired);
    render(<LicenseBanner roles={[role]} />);
    await expectNoBanner();
  });

  it.each(STAFF_NON_ADMIN)("%s never sees an invalid-licence notice", async (role) => {
    systemLicense.mockResolvedValue(STATES.invalid);
    render(<LicenseBanner roles={[role]} />);
    await expectNoBanner();
  });

  it.each(STAFF_NON_ADMIN)("%s never sees an absent-licence notice", async (role) => {
    systemLicense.mockResolvedValue(STATES.absent);
    render(<LicenseBanner roles={[role]} />);
    await expectNoBanner();
  });

  it("does fetch for non-admin staff (unlike a student)", async () => {
    systemLicense.mockResolvedValue(STATES.within7Days);
    render(<LicenseBanner roles={["teacher"]} />);
    await screen.findByText(/expires in 5 days/);
    expect(systemLicense).toHaveBeenCalledTimes(1);
  });
});
