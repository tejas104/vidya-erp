"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api, ApiError, currentAcademicYear,
  type AdjustmentKind, type FeeInvoiceView, type FeePaymentView, type PaymentMode,
} from "@/ui/api";
import { formatPaise, formatPaiseInWords } from "@/ui/money";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

type SectionOption = { id: string; label: string };

const MODES: PaymentMode[] = ["cash", "upi", "card", "bank", "gateway"];
const KINDS: AdjustmentKind[] = ["scholarship", "fine", "refund", "waiver"];

/** "1234.50" (rupees, as typed at the counter) → integer paise, or null if not a positive amount. */
function parseRupees(raw: string): number | null {
  const rupees = Number(raw);
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  return Math.round(rupees * 100);
}

function StatusBadge({ invoice, today }: { invoice: FeeInvoiceView; today: string }) {
  if (invoice.status === "paid") return <Badge tone="good">paid</Badge>;
  if (invoice.status === "waived") return <Badge>waived</Badge>;
  if (invoice.status === "part") return <Badge tone="warn">part</Badge>;
  return invoice.dueOn < today ? <Badge tone="danger">overdue</Badge> : <Badge>pending</Badge>;
}

/** The signature moment: a receipt counterfoil, rendered after a payment lands. */
function Counterfoil({ payment, invoice }: { payment: FeePaymentView; invoice: FeeInvoiceView }) {
  return (
    <div
      role="figure"
      aria-label={`Receipt ${payment.receiptNo}`}
      style={{ borderTop: "2px dashed var(--rule-strong)", paddingTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="num" style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--ink-2)" }}>RECEIPT</span>
        <strong className="num" style={{ fontSize: 24 }}>#{payment.receiptNo}</strong>
      </div>
      <div className="num" style={{ fontSize: 20 }}>{formatPaise(payment.amountPaise)}</div>
      <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{formatPaiseInWords(payment.amountPaise)}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Badge>{payment.mode}</Badge>
        <span style={{ fontSize: 13.5 }}>
          {invoice.headName} — <strong>{invoice.studentName}</strong> ({invoice.admissionNo})
        </span>
      </div>
      <div className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>
        {new Date(payment.receivedAt).toLocaleString()}
      </div>
    </div>
  );
}

export default function FeesPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionOption[] | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [invoices, setInvoices] = useState<FeeInvoiceView[]>([]);
  const [query, setQuery] = useState("");
  const [defaulters, setDefaulters] = useState<FeeInvoiceView[]>([]);
  const [saving, setSaving] = useState(false);
  // record-payment modal (shows the counterfoil after success)
  const [paying, setPaying] = useState<FeeInvoiceView | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [payRef, setPayRef] = useState("");
  const [receipt, setReceipt] = useState<FeePaymentView | null>(null);
  // adjustment modal
  const [adjusting, setAdjusting] = useState<FeeInvoiceView | null>(null);
  const [kind, setKind] = useState<AdjustmentKind>("scholarship");
  const [adjAmount, setAdjAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmWaive, setConfirmWaive] = useState(false);

  useEffect(() => {
    api.colleges()
      .then(async ({ colleges }) => {
        const college = colleges[0];
        if (!college) { setSections([]); return; }
        setCollegeId(college.id);
        const tree = await api.collegeTree(college.id);
        const found: SectionOption[] = [];
        for (const dep of tree.departments) {
          for (const cls of dep.classes) {
            for (const sec of cls.sections) found.push({ id: sec.id, label: `${cls.name} · ${sec.name}` });
          }
        }
        setSections(found);
        api.feesDefaulters(college.id, year)
          .then((r) => setDefaulters(r.defaulters))
          .catch(() => setDefaulters([]));
      })
      .catch(() => setSections([]));
  }, [year]);

  const loadInvoices = useCallback(async () => {
    if (sectionId === "") { setInvoices([]); return; }
    try {
      setInvoices((await api.feesSectionInvoices(sectionId, year)).invoices);
    } catch {
      setInvoices([]);
    }
  }, [sectionId, year]);
  useEffect(() => { void loadInvoices(); }, [loadInvoices]);

  /** A payment/adjustment answers with the fresh invoice — patch it into both tables. */
  function applyInvoice(updated: FeeInvoiceView) {
    setInvoices((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    setDefaulters((rows) =>
      updated.duesPaise <= 0 ? rows.filter((row) => row.id !== updated.id)
        : rows.map((row) => (row.id === updated.id ? updated : row)),
    );
  }

  function openPayment(invoice: FeeInvoiceView) {
    setPaying(invoice);
    setReceipt(null);
    setAmount((invoice.duesPaise / 100).toFixed(2));
    setMode("cash");
    setPayRef("");
  }

  async function recordPayment() {
    const paise = paying ? parseRupees(amount) : null;
    if (!paying || paise === null) return;
    setSaving(true);
    try {
      const { payment, invoice } = await api.feesRecordPayment({
        invoiceId: paying.id, amountPaise: paise, mode, ...(payRef.trim() !== "" ? { ref: payRef.trim() } : {}),
      });
      applyInvoice(invoice);
      setPaying(invoice);
      setReceipt(payment);
      toast.show(`Receipt #${payment.receiptNo} issued.`, "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't record the payment.", "danger");
    } finally {
      setSaving(false);
    }
  }

  function openAdjustment(invoice: FeeInvoiceView) {
    setAdjusting(invoice);
    setKind("scholarship");
    setAdjAmount("");
    setReason("");
  }

  async function submitAdjustment() {
    const paise = adjusting ? parseRupees(adjAmount) : null;
    if (!adjusting || paise === null) return;
    setSaving(true);
    try {
      const { invoice } = await api.feesAddAdjustment({
        invoiceId: adjusting.id, kind, amountPaise: paise, ...(reason.trim() !== "" ? { reason: reason.trim() } : {}),
      });
      applyInvoice(invoice);
      setAdjusting(null);
      toast.show(`${kind[0].toUpperCase()}${kind.slice(1)} recorded.`, "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't record the adjustment.", "danger");
    } finally {
      setSaving(false);
      setConfirmWaive(false);
    }
  }

  if (sections === null) return <Skeleton lines={5} />;

  const q = query.trim().toLowerCase();
  const visible = q === ""
    ? invoices
    : invoices.filter(
        (row) => row.studentName.toLowerCase().includes(q) || row.admissionNo.toLowerCase().includes(q),
      );

  const ledgerColumns: Column<FeeInvoiceView>[] = [
    {
      key: "student", header: "Student",
      render: (row) => (
        <span>
          <strong>{row.studentName}</strong>
          <span className="num" style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>{row.admissionNo}</span>
        </span>
      ),
    },
    { key: "head", header: "Head", render: (row) => row.headName },
    { key: "due", header: "Due on", render: (row) => <span className="num">{row.dueOn}</span> },
    { key: "amount", header: "Amount", align: "right", render: (row) => <span className="num">{formatPaise(row.amountPaise)}</span> },
    { key: "paid", header: "Paid", align: "right", render: (row) => <span className="num">{formatPaise(row.paidPaise)}</span> },
    { key: "dues", header: "Dues", align: "right", render: (row) => <strong className="num">{formatPaise(row.duesPaise)}</strong> },
    { key: "status", header: "Status", render: (row) => <StatusBadge invoice={row} today={today} /> },
    {
      key: "actions", header: "", align: "right",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 8 }}>
          {row.status !== "waived" && row.status !== "paid" ? (
            <Button variant="ghost" onClick={() => openPayment(row)}>Take payment</Button>
          ) : null}
          {row.status !== "waived" ? (
            <Button variant="ghost" onClick={() => openAdjustment(row)}>Adjust</Button>
          ) : null}
        </span>
      ),
    },
  ];

  const defaulterColumns: Column<FeeInvoiceView>[] = [
    {
      key: "student", header: "Student",
      render: (row) => (
        <span>
          <strong>{row.studentName}</strong>
          <span className="num" style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>{row.admissionNo}</span>
        </span>
      ),
    },
    { key: "head", header: "Head", render: (row) => row.headName },
    { key: "due", header: "Due on", render: (row) => <span className="num">{row.dueOn}</span> },
    { key: "dues", header: "Dues", align: "right", render: (row) => <strong className="num">{formatPaise(row.duesPaise)}</strong> },
  ];

  return (
    <>
      <PageHeader
        eyebrow={`Fees · ${year}`}
        title="Fee counter"
        lede="Open a section's ledger, take a payment, hand over the receipt."
      />

      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="Section" htmlFor="fee-section">
          <select id="fee-section" value={sectionId} onChange={(event) => setSectionId(event.target.value)} style={{ minWidth: 220 }}>
            <option value="">Pick a section…</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>{section.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Find student" htmlFor="fee-query">
          <input
            id="fee-query" placeholder="Name or admission no."
            value={query} onChange={(event) => setQuery(event.target.value)} style={{ minWidth: 240 }}
          />
        </Field>
      </div>

      <section className="section" aria-label="Invoice ledger">
        {sectionId === "" ? (
          <EmptyState title="Pick a section to open its ledger." message="Every invoice for the year appears as a ruled row." />
        ) : (
          <DataTable
            columns={ledgerColumns} rows={visible} rowKey={(row) => row.id}
            empty={{ title: `No invoices for ${year}.`, message: "Invoices appear once they are generated for this section's class." }}
          />
        )}
      </section>

      <section className="section" aria-label="Outstanding dues">
        <div className="section-head"><h2>Outstanding dues</h2></div>
        <DataTable
          columns={defaulterColumns} rows={defaulters} rowKey={(row) => row.id}
          empty={{ title: `No outstanding dues for ${year}.`, message: "Every generated invoice is settled." }}
        />
      </section>

      {/* RECORD PAYMENT → COUNTERFOIL */}
      <Modal
        open={paying !== null}
        onClose={() => setPaying(null)}
        title={receipt ? "Payment recorded" : `Take payment — ${paying?.studentName ?? ""}`}
        footer={
          receipt ? (
            <Button onClick={() => setPaying(null)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setPaying(null)}>Cancel</Button>
              <Button onClick={() => void recordPayment()} loading={saving} disabled={parseRupees(amount) === null}>
                Record payment
              </Button>
            </>
          )
        }
      >
        {receipt && paying ? (
          <Counterfoil payment={receipt} invoice={paying} />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>
              {paying?.headName} · dues <strong className="num">{formatPaise(paying?.duesPaise ?? 0)}</strong>
            </p>
            <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
              <Field label="Amount (₹)" htmlFor="pay-amount">
                <input id="pay-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} style={{ width: 140 }} />
              </Field>
              <Field label="Mode" htmlFor="pay-mode">
                <select id="pay-mode" value={mode} onChange={(event) => setMode(event.target.value as PaymentMode)}>
                  {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Reference (optional)" htmlFor="pay-ref">
              <input id="pay-ref" placeholder="UPI ref / cheque no." value={payRef} onChange={(event) => setPayRef(event.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      {/* ADJUSTMENT */}
      <Modal
        open={adjusting !== null}
        onClose={() => setAdjusting(null)}
        title={`Adjustment — ${adjusting?.studentName ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjusting(null)}>Cancel</Button>
            <Button
              onClick={() => (kind === "waiver" ? setConfirmWaive(true) : void submitAdjustment())}
              loading={saving}
              disabled={parseRupees(adjAmount) === null}
            >
              Record
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <Field label="Kind" htmlFor="adj-kind">
              <select id="adj-kind" value={kind} onChange={(event) => setKind(event.target.value as AdjustmentKind)}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Amount (₹)" htmlFor="adj-amount">
              <input id="adj-amount" inputMode="decimal" value={adjAmount} onChange={(event) => setAdjAmount(event.target.value)} style={{ width: 140 }} />
            </Field>
          </div>
          <Field label="Reason" htmlFor="adj-reason">
            <input id="adj-reason" placeholder="Why this adjustment is being made" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmWaive}
        title="Waive this invoice"
        message={`Waive ${formatPaise(parseRupees(adjAmount) ?? 0)} for ${adjusting?.studentName ?? ""}? No further payments will be accepted on a waived invoice.`}
        confirmLabel="Waive"
        danger
        onConfirm={() => void submitAdjustment()}
        onCancel={() => setConfirmWaive(false)}
      />
    </>
  );
}
