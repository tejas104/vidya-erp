import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountingPage from "../../app/(app)/manage/accounting/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api,
    session: vi.fn(), colleges: vi.fn(), feesCollectionSummary: vi.fn(), feesDefaulters: vi.fn(),
  } };
});

beforeEach(() => {
  vi.clearAllMocks();
  (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u_1", displayName: "Accountant", roles: ["accountant"], grants: [] });
  (api.colleges as ReturnType<typeof vi.fn>).mockResolvedValue({ colleges: [{ id: "col_1", name: "Demo School" }] });
  (api.feesCollectionSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ totalPaise: 123456, byMode: [{ mode: "upi", totalPaise: 123456, count: 2 }] });
  (api.feesDefaulters as ReturnType<typeof vi.fn>).mockResolvedValue({ defaulters: [{ id: "i_1", studentId: "s_1", studentName: "Meera Das", headName: "Tuition", dueOn: "2026-10-15", duesPaise: 4567 }] });
});

describe("Accounting desk", () => {
  it("shows exact paise, outstanding work and the fee counter to an accountant", async () => {
    render(<AccountingPage />);
    expect(await screen.findByRole("heading", { name: "Accounting desk" })).toBeInTheDocument();
    expect((await screen.findAllByText("₹1,234.56")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹45.67").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open fee counter" })).toHaveAttribute("href", "/manage/fees");
    expect(screen.getByRole("region", { name: "Outstanding invoices" })).toHaveTextContent("Meera Das");
  });
  it("does not expose accounting figures to an unrelated role", async () => {
    (api.session as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u_2", displayName: "Teacher", roles: ["teacher"], grants: [] });
    render(<AccountingPage />);
    expect(await screen.findByText("Accounting is outside your role.")).toBeInTheDocument();
    expect(screen.queryByText("₹1,234.56")).not.toBeInTheDocument();
    expect(api.feesCollectionSummary).not.toHaveBeenCalled();
  });
});
