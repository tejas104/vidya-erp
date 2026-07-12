import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FeesPage from "../../app/(app)/manage/fees/page";
import { api, ApiError, type FeeInvoiceView } from "./api";
import { ToastProvider } from "./Toast";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      session: vi.fn(), colleges: vi.fn(), collegeTree: vi.fn(),
      feesDefaulters: vi.fn(), feesSectionInvoices: vi.fn(),
      feesRecordPayment: vi.fn(), feesAddAdjustment: vi.fn(),
      feesHeads: vi.fn(), feesCreateHead: vi.fn(), feesDeleteHead: vi.fn(),
      feesStructures: vi.fn(), feesCreateStructure: vi.fn(),
      feesGenerate: vi.fn(), feesGenerateStatus: vi.fn(),
      feesCollectionSummary: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "CS", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [{ id: "sec_1", classId: "cls_1", name: "A" }] }],
      subjects: [],
    },
  ],
};

const base = {
  collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1",
  structureId: "str_1", headId: "head_1", headName: "Tuition", academicYear: "2026-27",
};
const overdueInvoice: FeeInvoiceView = {
  ...base, id: "inv_1", studentId: "stu_2", studentName: "Meera Iyer", admissionNo: "FYCS-002",
  amountPaise: 50_000, dueOn: "2026-06-30", status: "pending", paidPaise: 0, duesPaise: 50_000,
};
const paidInvoice: FeeInvoiceView = {
  ...base, id: "inv_2", studentId: "stu_1", studentName: "Aarav Sharma", admissionNo: "FYCS-001",
  amountPaise: 120_000, dueOn: "2026-08-01", status: "paid", paidPaise: 120_000, duesPaise: 0,
};

function mock<T extends keyof typeof api>(name: T) {
  return api[name] as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mock("session").mockResolvedValue({ userId: "u_acct", displayName: "Asha", roles: ["accountant"], grants: [] });
  mock("feesHeads").mockResolvedValue({ heads: [] });
  mock("feesStructures").mockResolvedValue({ structures: [] });
  mock("colleges").mockResolvedValue({ colleges: [tree.college] });
  mock("collegeTree").mockResolvedValue(tree);
  mock("feesDefaulters").mockResolvedValue({ defaulters: [overdueInvoice] });
  mock("feesSectionInvoices").mockResolvedValue({ invoices: [overdueInvoice, paidInvoice] });
  mock("feesRecordPayment").mockResolvedValue({
    payment: {
      id: "pay_1", invoiceId: "inv_1", receiptNo: 101, amountPaise: 50_000,
      mode: "cash", ref: "", receivedBy: "u_acct", receivedAt: "2026-07-13T10:00:00Z",
    },
    invoice: { ...overdueInvoice, status: "paid", paidPaise: 50_000, duesPaise: 0 },
  });
});

async function openLedger() {
  render(<ToastProvider><FeesPage /></ToastProvider>);
  fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "sec_1" } });
  await screen.findByText("Meera Iyer");
}

describe("/manage/fees — the counter", () => {
  it("opens a section ledger with formatted rupees and an overdue badge", async () => {
    await openLedger();
    expect(screen.getAllByText("₹500.00").length).toBeGreaterThan(0);
    expect(screen.getByText("overdue")).toBeInTheDocument();
    expect(screen.getByText("paid")).toBeInTheDocument();
  });

  it("filters the ledger by admission number", async () => {
    await openLedger();
    fireEvent.change(screen.getByLabelText("Find student"), { target: { value: "fycs-002" } });
    // Meera stays (ledger row + outstanding-dues row); Aarav's ledger row is filtered out
    expect(screen.getAllByText("Meera Iyer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Aarav Sharma")).not.toBeInTheDocument();
  });

  it("records a payment in integer paise and shows the counterfoil", async () => {
    await openLedger();
    fireEvent.click(screen.getByRole("button", { name: /take payment/i }));
    // amount is prefilled with the dues
    expect(screen.getByLabelText("Amount (₹)")).toHaveValue("500.00");
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await waitFor(() =>
      expect(api.feesRecordPayment).toHaveBeenCalledWith({ invoiceId: "inv_1", amountPaise: 50_000, mode: "cash" }),
    );
    // the counterfoil: receipt number, amount in words
    expect(await screen.findByText("#101")).toBeInTheDocument();
    expect(screen.getByText("Rupees five hundred only")).toBeInTheDocument();
    expect(screen.getByText("Receipt #101 issued.")).toBeInTheDocument();
  });

  it("surfaces the waived-invoice conflict as the server states it", async () => {
    mock("feesRecordPayment").mockRejectedValue(new ApiError(409, "Invoice is waived — no further payments accepted"));
    await openLedger();
    fireEvent.click(screen.getByRole("button", { name: /take payment/i }));
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    expect(await screen.findByText("Invoice is waived — no further payments accepted")).toBeInTheDocument();
  });

  it("hides the Setup tab from the accountant", async () => {
    render(<ToastProvider><FeesPage /></ToastProvider>);
    await screen.findByLabelText("Section");
    expect(screen.queryByRole("tab", { name: "Setup" })).not.toBeInTheDocument();
  });

  it("lets the admin add a fee head from the Setup tab", async () => {
    mock("session").mockResolvedValue({ userId: "u_adm", displayName: "Admin", roles: ["admin"], grants: [] });
    mock("feesCreateHead").mockResolvedValue({ id: "head_9", collegeId: "col_1", name: "Tuition" });
    render(<ToastProvider><FeesPage /></ToastProvider>);
    await screen.findByLabelText("Section");
    fireEvent.click(await screen.findByRole("tab", { name: "Setup" }));
    fireEvent.change(screen.getByLabelText("New head"), { target: { value: "Tuition" } });
    fireEvent.click(screen.getByRole("button", { name: /add head/i }));
    await waitFor(() => expect(api.feesCreateHead).toHaveBeenCalledWith({ collegeId: "col_1", name: "Tuition" }));
    expect(screen.getByText("Tuition")).toBeInTheDocument();
  });

  it("shows collection totals by mode", async () => {
    mock("feesCollectionSummary").mockResolvedValue({
      from: "2026-07-13", to: "2026-07-13", totalPaise: 150_000,
      byMode: [{ mode: "cash", totalPaise: 100_000, count: 2 }, { mode: "upi", totalPaise: 50_000, count: 1 }],
    });
    render(<ToastProvider><FeesPage /></ToastProvider>);
    await screen.findByLabelText("Section");
    fireEvent.click(screen.getByRole("tab", { name: "Collections" }));
    fireEvent.click(screen.getByRole("button", { name: /show collections/i }));
    expect(await screen.findByText("₹1,500.00")).toBeInTheDocument();
    expect(screen.getByText("Receipts issued")).toBeInTheDocument();
    expect(screen.getByText("₹1,000.00")).toBeInTheDocument();
  });
});
