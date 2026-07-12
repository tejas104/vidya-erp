import { describe, expect, it } from "vitest";
import { computeLedger, computeStatus, formatRupees, nextReceiptNo, sumAdjustments } from "./money";

describe("money — paise math (golden numbers)", () => {
  it("an untouched invoice is fully due and pending", () => {
    const ledger = computeLedger(500_000, [], []);
    expect(ledger).toEqual({
      finesPaise: 0,
      scholarshipsPaise: 0,
      waiversPaise: 0,
      refundsPaise: 0,
      paidPaise: 0,
      effectiveDuePaise: 500_000,
      effectivePaidPaise: 0,
      duesPaise: 500_000,
      hasWaiver: false,
    });
    expect(computeStatus(ledger)).toBe("pending");
  });

  it("a partial payment reduces dues and marks the invoice part-paid", () => {
    // ₹5000.00 invoice, ₹2000.00 paid.
    const ledger = computeLedger(500_000, [{ amountPaise: 200_000 }], []);
    expect(ledger.paidPaise).toBe(200_000);
    expect(ledger.duesPaise).toBe(300_000);
    expect(computeStatus(ledger)).toBe("part");
  });

  it("payments covering the full amount mark the invoice paid", () => {
    const ledger = computeLedger(500_000, [{ amountPaise: 300_000 }, { amountPaise: 200_000 }], []);
    expect(ledger.duesPaise).toBe(0);
    expect(computeStatus(ledger)).toBe("paid");
  });

  it("overpayment yields negative dues and still reads as paid", () => {
    const ledger = computeLedger(500_000, [{ amountPaise: 600_000 }], []);
    expect(ledger.duesPaise).toBe(-100_000);
    expect(computeStatus(ledger)).toBe("paid");
  });

  it("a fine increases the effective due", () => {
    // ₹5000.00 invoice + ₹100.00 fine, nothing paid yet.
    const ledger = computeLedger(500_000, [], [{ kind: "fine", amountPaise: 10_000 }]);
    expect(ledger.effectiveDuePaise).toBe(510_000);
    expect(ledger.duesPaise).toBe(510_000);
    expect(computeStatus(ledger)).toBe("pending");
  });

  it("a scholarship reduces the effective due (golden: full worked example)", () => {
    // ₹5000.00 invoice, ₹100.00 fine, ₹500.00 scholarship, ₹2000.00 paid.
    // effectiveDue  = 500000 + 10000 - 50000 - 0       = 460000
    // effectivePaid = 200000 - 0                       = 200000
    // dues          = 460000 - 200000                  = 260000  (₹2600.00)
    const ledger = computeLedger(
      500_000,
      [{ amountPaise: 200_000 }],
      [
        { kind: "fine", amountPaise: 10_000 },
        { kind: "scholarship", amountPaise: 50_000 },
      ],
    );
    expect(ledger.effectiveDuePaise).toBe(460_000);
    expect(ledger.effectivePaidPaise).toBe(200_000);
    expect(ledger.duesPaise).toBe(260_000);
    expect(computeStatus(ledger)).toBe("part");
    expect(formatRupees(ledger.duesPaise)).toBe("2600.00");
  });

  it("a refund gives back collected money, increasing what remains outstanding", () => {
    // ₹5000.00 invoice, ₹5000.00 paid (fully paid), then a ₹500.00 refund.
    const ledger = computeLedger(500_000, [{ amountPaise: 500_000 }], [{ kind: "refund", amountPaise: 50_000 }]);
    expect(ledger.effectivePaidPaise).toBe(450_000);
    expect(ledger.duesPaise).toBe(50_000);
    expect(computeStatus(ledger)).toBe("part");
  });

  it("a waiver always resolves the invoice to waived, regardless of amount", () => {
    const fullyWaived = computeLedger(500_000, [], [{ kind: "waiver", amountPaise: 500_000 }]);
    expect(computeStatus(fullyWaived)).toBe("waived");

    // Even a token waiver (partial amount) reads as a full write-off — an
    // office decision, not a partial credit.
    const partialWaiver = computeLedger(500_000, [], [{ kind: "waiver", amountPaise: 1_000 }]);
    expect(computeStatus(partialWaiver)).toBe("waived");
  });

  it("sumAdjustments buckets by kind independent of ordering", () => {
    const totals = sumAdjustments([
      { kind: "fine", amountPaise: 100 },
      { kind: "scholarship", amountPaise: 200 },
      { kind: "waiver", amountPaise: 300 },
      { kind: "refund", amountPaise: 400 },
      { kind: "fine", amountPaise: 50 },
    ]);
    expect(totals).toEqual({
      finesPaise: 150,
      scholarshipsPaise: 200,
      waiversPaise: 300,
      refundsPaise: 400,
      paidPaise: 0,
      hasWaiver: true,
    });
  });

  it("formatRupees converts paise to a two-decimal rupee string", () => {
    expect(formatRupees(0)).toBe("0.00");
    expect(formatRupees(1)).toBe("0.01");
    expect(formatRupees(100)).toBe("1.00");
    expect(formatRupees(123_456)).toBe("1234.56");
  });

  describe("receipt monotonicity", () => {
    it("nextReceiptNo is a pure +1 step from the counter's last-issued value", () => {
      expect(nextReceiptNo(0)).toBe(1);
      expect(nextReceiptNo(1)).toBe(2);
      expect(nextReceiptNo(41)).toBe(42);
    });

    it("issuing a run of receipts sequentially is strictly increasing with no gaps or repeats", () => {
      let counter = 0;
      const issued: number[] = [];
      for (let i = 0; i < 25; i++) {
        counter = nextReceiptNo(counter);
        issued.push(counter);
      }
      expect(issued).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
      expect(new Set(issued).size).toBe(issued.length);
    });
  });
});
