"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api, ApiError, currentAcademicYear,
  type AdjustmentKind, type FeeCollectionSummary, type FeeGenerationRunView, type FeeHeadView,
  type FeeInvoiceView, type FeePaymentView, type FeeStructureView, type PaymentMode,
} from "@/ui/api";
import { formatPaise, formatPaiseInWords } from "@/ui/money";
import { Tabs } from "@/ui/Tabs";
import { StatTile } from "@/ui/charts";
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
type ClassOption = { id: string; label: string };

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
  // tabs (Setup is admin-only; the server enforces regardless)
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState("counter");
  // setup tab
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [heads, setHeads] = useState<FeeHeadView[]>([]);
  const [newHead, setNewHead] = useState("");
  const [classId, setClassId] = useState("");
  const [structures, setStructures] = useState<FeeStructureView[]>([]);
  const [structOpen, setStructOpen] = useState(false);
  const [structHeadId, setStructHeadId] = useState("");
  const [structAmount, setStructAmount] = useState("");
  const [structDue, setStructDue] = useState(today);
  const [structInst, setStructInst] = useState("1");
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [run, setRun] = useState<FeeGenerationRunView | null>(null);
  // collections tab
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [summary, setSummary] = useState<FeeCollectionSummary | null>(null);

  useEffect(() => {
    api.session().then((me) => setIsAdmin(me.roles.includes("admin"))).catch(() => undefined);
    api.colleges()
      .then(async ({ colleges }) => {
        const college = colleges[0];
        if (!college) { setSections([]); return; }
        setCollegeId(college.id);
        const tree = await api.collegeTree(college.id);
        const foundSections: SectionOption[] = [];
        const foundClasses: ClassOption[] = [];
        for (const dep of tree.departments) {
          for (const cls of dep.classes) {
            foundClasses.push({ id: cls.id, label: cls.name });
            for (const sec of cls.sections) foundSections.push({ id: sec.id, label: `${cls.name} · ${sec.name}` });
          }
        }
        setSections(foundSections);
        setClasses(foundClasses);
        api.feesDefaulters(college.id, year)
          .then((r) => setDefaulters(r.defaulters))
          .catch(() => setDefaulters([]));
        api.feesHeads(college.id)
          .then((r) => setHeads(r.heads))
          .catch(() => setHeads([]));
      })
      .catch(() => setSections([]));
  }, [year]);

  const loadStructures = useCallback(async () => {
    if (classId === "") { setStructures([]); return; }
    try {
      setStructures((await api.feesStructures(classId, year)).structures);
    } catch {
      setStructures([]);
    }
  }, [classId, year]);
  useEffect(() => { void loadStructures(); }, [loadStructures]);

  // poll a generation run until it settles
  useEffect(() => {
    if (!run || run.status === "completed" || run.status === "failed") return;
    const timer = setTimeout(() => {
      api.feesGenerateStatus(run.id).then(setRun).catch(() => undefined);
    }, 1200);
    return () => clearTimeout(timer);
  }, [run]);

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
      toast.show(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} recorded.`, "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't record the adjustment.", "danger");
    } finally {
      setSaving(false);
      setConfirmWaive(false);
    }
  }

  async function addHead() {
    if (collegeId === null || newHead.trim() === "") return;
    setSaving(true);
    try {
      const head = await api.feesCreateHead({ collegeId, name: newHead.trim() });
      setHeads((rows) => [...rows, head]);
      setNewHead("");
      toast.show(`Head "${head.name}" added.`, "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't add the head.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function removeHead(head: FeeHeadView) {
    try {
      await api.feesDeleteHead(head.id);
      setHeads((rows) => rows.filter((row) => row.id !== head.id));
      toast.show(`Head "${head.name}" deleted.`, "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't delete — still used by a structure.", "danger");
    }
  }

  async function createStructure() {
    const paise = parseRupees(structAmount);
    if (classId === "" || structHeadId === "" || paise === null) return;
    setSaving(true);
    try {
      await api.feesCreateStructure({
        classId, headId: structHeadId, academicYear: year,
        amountPaise: paise, dueOn: structDue, installmentNo: Number(structInst) || 1,
      });
      toast.show("Structure set.", "good");
      setStructOpen(false);
      setStructAmount("");
      await loadStructures();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't set the structure.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function startGenerate() {
    setConfirmGenerate(false);
    if (classId === "") return;
    try {
      const { runId } = await api.feesGenerate({ classId, academicYear: year });
      setRun({
        id: runId, collegeId: collegeId ?? "", classId, academicYear: year,
        status: "pending", invoicesCreated: 0, invoicesSkipped: 0, error: null,
      });
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't start the run.", "danger");
    }
  }

  async function loadSummary() {
    if (collegeId === null) return;
    try {
      setSummary(await api.feesCollectionSummary(collegeId, from, to));
    } catch (caught) {
      setSummary(null);
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't load collections.", "danger");
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

  const structureColumns: Column<FeeStructureView>[] = [
    { key: "head", header: "Head", render: (row) => <strong>{row.headName}</strong> },
    { key: "inst", header: "Inst.", align: "right", render: (row) => <span className="num">{row.installmentNo}</span> },
    { key: "amount", header: "Amount", align: "right", render: (row) => <span className="num">{formatPaise(row.amountPaise)}</span> },
    { key: "due", header: "Due on", render: (row) => <span className="num">{row.dueOn}</span> },
  ];

  const modeColumns: Column<FeeCollectionSummary["byMode"][number]>[] = [
    { key: "mode", header: "Mode", render: (row) => <Badge>{row.mode}</Badge> },
    { key: "count", header: "Receipts", align: "right", render: (row) => <span className="num">{row.count}</span> },
    { key: "total", header: "Collected", align: "right", render: (row) => <strong className="num">{formatPaise(row.totalPaise)}</strong> },
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

      <Tabs
        tabs={[
          { id: "counter", label: "Counter" },
          ...(isAdmin ? [{ id: "setup", label: "Setup" }] : []),
          { id: "collections", label: "Collections" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "counter" ? (
        <>
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
        </>
      ) : null}

      {tab === "setup" && isAdmin ? (
        <>
          <section className="section" aria-label="Fee heads">
            <div className="section-head"><h2>Fee heads</h2></div>
            <div style={{ display: "grid", gap: 0 }}>
              {heads.map((head) => (
                <div key={head.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--rule)", padding: "6px 0" }}>
                  <span>{head.name}</span>
                  <Button variant="ghost" onClick={() => void removeHead(head)}>Delete</Button>
                </div>
              ))}
              {heads.length === 0 ? (
                <p style={{ fontSize: 13.5, color: "var(--ink-2)" }}>No heads yet — add Tuition, Library, Lab…</p>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", marginTop: "var(--space-3)" }}>
              <Field label="New head" htmlFor="head-name">
                <input id="head-name" placeholder="e.g. Tuition" value={newHead} onChange={(event) => setNewHead(event.target.value)} />
              </Field>
              <Button onClick={() => void addHead()} loading={saving} disabled={newHead.trim() === ""}>Add head</Button>
            </div>
          </section>

          <section className="section" aria-label="Class structures">
            <div className="section-head">
              <h2>Class structures · {year}</h2>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <Button variant="ghost" onClick={() => setStructOpen(true)} disabled={classId === "" || heads.length === 0}>Set structure</Button>
                <Button onClick={() => setConfirmGenerate(true)} disabled={classId === "" || structures.length === 0}>Generate invoices</Button>
              </span>
            </div>
            <Field label="Class" htmlFor="fee-class">
              <select id="fee-class" value={classId} onChange={(event) => setClassId(event.target.value)} style={{ maxWidth: 280 }}>
                <option value="">Pick a class…</option>
                {classes.map((cls) => <option key={cls.id} value={cls.id}>{cls.label}</option>)}
              </select>
            </Field>
            {run ? (
              <p className="num" style={{ fontSize: 13 }} aria-live="polite">
                {run.status === "failed"
                  ? `Generation failed: ${run.error ?? "unknown error"}`
                  : run.status === "completed"
                    ? `Generated — created ${run.invoicesCreated} · skipped ${run.invoicesSkipped}`
                    : `Generating… created ${run.invoicesCreated} · skipped ${run.invoicesSkipped}`}
              </p>
            ) : null}
            {classId === "" ? (
              <EmptyState title="Pick a class to see its fee structures." message="One row per head, year and installment." />
            ) : (
              <DataTable
                columns={structureColumns} rows={structures} rowKey={(row) => row.id}
                empty={{ title: `No structures for ${year}.`, message: "Set one with the button above — invoices generate from structures." }}
              />
            )}
          </section>
        </>
      ) : null}

      {tab === "collections" ? (
        <section className="section" aria-label="Collections">
          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "var(--space-4)" }}>
            <Field label="From" htmlFor="col-from">
              <input id="col-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="To" htmlFor="col-to">
              <input id="col-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
            <Button onClick={() => void loadSummary()}>Show collections</Button>
          </div>
          {summary === null ? (
            <EmptyState title="Pick a range and show collections." message="Totals come from issued receipts — reconcile the cash box against them." />
          ) : (
            <>
              <section className="stats" aria-label="Collection totals" style={{ marginBottom: "var(--space-4)" }}>
                <StatTile value={formatPaise(summary.totalPaise)} label="Collected" sub={`${summary.from} → ${summary.to}`} />
                <StatTile value={String(summary.byMode.reduce((n, m) => n + m.count, 0))} label="Receipts issued" />
              </section>
              <DataTable
                columns={modeColumns} rows={summary.byMode} rowKey={(row) => row.mode}
                empty={{ title: "No collections in this range.", message: "Payments recorded at the counter appear here." }}
              />
            </>
          )}
        </section>
      ) : null}

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

      {/* SET STRUCTURE */}
      <Modal
        open={structOpen}
        onClose={() => setStructOpen(false)}
        title={`Set structure — ${classes.find((cls) => cls.id === classId)?.label ?? ""} · ${year}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStructOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void createStructure()}
              loading={saving}
              disabled={structHeadId === "" || parseRupees(structAmount) === null}
            >
              Set structure
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Head" htmlFor="struct-head">
            <select id="struct-head" value={structHeadId} onChange={(event) => setStructHeadId(event.target.value)}>
              <option value="">Pick a head…</option>
              {heads.map((head) => <option key={head.id} value={head.id}>{head.name}</option>)}
            </select>
          </Field>
          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <Field label="Amount (₹)" htmlFor="struct-amount">
              <input id="struct-amount" inputMode="decimal" value={structAmount} onChange={(event) => setStructAmount(event.target.value)} style={{ width: 140 }} />
            </Field>
            <Field label="Due on" htmlFor="struct-due">
              <input id="struct-due" type="date" value={structDue} onChange={(event) => setStructDue(event.target.value)} />
            </Field>
            <Field label="Installment" htmlFor="struct-inst">
              <input id="struct-inst" type="number" min={1} max={12} value={structInst} onChange={(event) => setStructInst(event.target.value)} style={{ width: 90 }} />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmGenerate}
        title="Generate invoices"
        message={`Generate invoices for ${classes.find((cls) => cls.id === classId)?.label ?? ""} · ${year}? Students already invoiced are skipped, so re-running is safe.`}
        confirmLabel="Generate"
        onConfirm={() => void startGenerate()}
        onCancel={() => setConfirmGenerate(false)}
      />

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
