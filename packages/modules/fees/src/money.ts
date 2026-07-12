/**
 * Pure money math — no I/O, no Date.now(), no randomness. Every amount is an
 * integer number of PAISE (never a float): ₹1 = 100 paise. Display converts
 * at the edge only: `₹${(paise / 100).toFixed(2)}` (house convention).
 *
 * Dues formula (the ADR the report cites): a fine INCREASES what is owed, a
 * scholarship or waiver REDUCES it, a refund gives back money already
 * collected (so it increases what is still outstanding):
 *
 *   effectiveDue  = invoice.amount + fines - scholarships - waivers
 *   effectivePaid = payments - refunds
 *   dues          = effectiveDue - effectivePaid
 *
 * A "waiver" is a full write-off of the remaining balance (an office
 * decision, not a partial credit): recording one always resolves the
 * invoice to "waived", regardless of the waiver's amount.
 */

export type AdjustmentKind = "scholarship" | "fine" | "refund" | "waiver";
export type InvoiceStatus = "pending" | "part" | "paid" | "waived";

export interface PaymentLike {
  readonly amountPaise: number;
}
export interface AdjustmentLike {
  readonly kind: AdjustmentKind;
  readonly amountPaise: number;
}

export interface LedgerTotals {
  readonly finesPaise: number;
  readonly scholarshipsPaise: number;
  readonly waiversPaise: number;
  readonly refundsPaise: number;
  readonly paidPaise: number;
}

export interface Ledger extends LedgerTotals {
  /** invoice.amount + fines - scholarships - waivers. */
  readonly effectiveDuePaise: number;
  /** payments - refunds. */
  readonly effectivePaidPaise: number;
  /** effectiveDuePaise - effectivePaidPaise. Can be negative (overpaid). */
  readonly duesPaise: number;
  readonly hasWaiver: boolean;
}

export function sumAdjustments(adjustments: readonly AdjustmentLike[]): LedgerTotals & { hasWaiver: boolean } {
  let finesPaise = 0;
  let scholarshipsPaise = 0;
  let waiversPaise = 0;
  let refundsPaise = 0;
  let hasWaiver = false;
  for (const adjustment of adjustments) {
    switch (adjustment.kind) {
      case "fine":
        finesPaise += adjustment.amountPaise;
        break;
      case "scholarship":
        scholarshipsPaise += adjustment.amountPaise;
        break;
      case "waiver":
        waiversPaise += adjustment.amountPaise;
        hasWaiver = true;
        break;
      case "refund":
        refundsPaise += adjustment.amountPaise;
        break;
    }
  }
  return { finesPaise, scholarshipsPaise, waiversPaise, refundsPaise, paidPaise: 0, hasWaiver };
}

export function computeLedger(
  invoiceAmountPaise: number,
  payments: readonly PaymentLike[],
  adjustments: readonly AdjustmentLike[],
): Ledger {
  const totals = sumAdjustments(adjustments);
  const paidPaise = payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
  const effectiveDuePaise = invoiceAmountPaise + totals.finesPaise - totals.scholarshipsPaise - totals.waiversPaise;
  const effectivePaidPaise = paidPaise - totals.refundsPaise;
  const duesPaise = effectiveDuePaise - effectivePaidPaise;
  return {
    ...totals,
    paidPaise,
    effectiveDuePaise,
    effectivePaidPaise,
    duesPaise,
  };
}

/** Derives the stored invoice status from a computed ledger. */
export function computeStatus(ledger: Ledger): InvoiceStatus {
  if (ledger.hasWaiver) return "waived";
  if (ledger.duesPaise <= 0) return "paid";
  if (ledger.effectivePaidPaise > 0) return "part";
  return "pending";
}

/** ₹ (paise/100).toFixed(2) — the one place amounts convert to display units. */
export function formatRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** The next receipt number given the counter's last-issued value. Pure —
 * the concurrency-safety comes from the caller doing this inside a
 * single-row `UPDATE ... RETURNING` transaction (see repo.ts). */
export function nextReceiptNo(lastIssued: number): number {
  return lastIssued + 1;
}

export type PaymentMode = "cash" | "upi" | "card" | "bank" | "gateway";
