"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api, ApiError, currentAcademicYear,
  type AdjustmentKind, type FeeCollectionSummary, type FeeGenerationRunView, type FeeHeadView,
  type FeeInvoiceView, type FeePaymentView, type FeeStructureView, type PaymentMode,
} from "@/ui/api";
import { formatPaise, formatPaiseInWords } from "@/ui/money";
import { StatTile } from "@/ui/charts";
import { AsyncState } from "@/ui/AsyncState";
import { AVATARS, initials } from "@/ui/avatar";
import { StudentSlideOver, type DrawerStudent } from "@/ui/StudentSlideOver";
import {
  useToast, Button, Input, Select, Modal, Table, StatusBadge, Tabs, EmptyState, Skeleton, PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import { HelpButton } from "@/ui/help/HelpButton";
import styles from "./page.module.css";

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

function invoiceBadge(invoice: FeeInvoiceView, today: string): ReactNode {
  if (invoice.status === "paid") return <StatusBadge status="good">paid</StatusBadge>;
  if (invoice.status === "waived") return <StatusBadge status="neutral">waived</StatusBadge>;
  if (invoice.status === "part") return <StatusBadge status="warn">part</StatusBadge>;
  return invoice.dueOn < today ? <StatusBadge status="danger">overdue</StatusBadge> : <StatusBadge status="neutral">pending</StatusBadge>;
}

/** The signature moment: a receipt counterfoil, rendered after a payment lands. */
function Counterfoil({ payment, invoice }: { payment: FeePaymentView; invoice: FeeInvoiceView }) {
  return (
    <div role="figure" aria-label={`Receipt ${payment.receiptNo}`} className={styles.counterfoil}>
      <div className={styles.counterfoilHead}>
        <span className={`num ${styles.receiptLabel}`}>RECEIPT</span>
        <strong className={`num ${styles.receiptNo}`}>#{payment.receiptNo}</strong>
      </div>
      <div className={`num ${styles.receiptAmount}`}>{formatPaise(payment.amountPaise)}</div>
      <div className={styles.receiptWords}>{formatPaiseInWords(payment.amountPaise)}</div>
      <div className={styles.receiptMeta}>
        <StatusBadge status="neutral">{payment.mode}</StatusBadge>
        <span>
          {invoice.headName} — <strong>{invoice.studentName}</strong> ({invoice.admissionNo})
        </span>
      </div>
      <div className={`num ${styles.receiptTime}`}>
        {new Date(payment.receivedAt).toLocaleString()}
      </div>
    </div>
  );
}

type LedgerRow = {
  student: ReactNode; head: ReactNode; due: ReactNode; amount: ReactNode; paid: ReactNode;
  dues: ReactNode; status: ReactNode; actions: ReactNode;
};
type DefaulterRow = { student: ReactNode; head: ReactNode; due: ReactNode; dues: ReactNode };
type StructureRow = { head: ReactNode; inst: ReactNode; amount: ReactNode; due: ReactNode };
type ModeRow = { mode: ReactNode; count: ReactNode; total: ReactNode };

export default function FeesPage() {
  const toast = useToast();
  const year = useMemo(() => currentAcademicYear(), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionOption[] | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [invoices, setInvoices] = useState<FeeInvoiceView[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState(false);
  const [query, setQuery] = useState("");
  const [defaulters, setDefaulters] = useState<FeeInvoiceView[]>([]);
  const [saving, setSaving] = useState(false);
  // record-payment modal (shows the counterfoil after success)
  const [paying, setPaying] = useState<FeeInvoiceView | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [payRef, setPayRef] = useState("");
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState("");
  const [receipt, setReceipt] = useState<FeePaymentView | null>(null);
  // adjustment modal
  const [adjusting, setAdjusting] = useState<FeeInvoiceView | null>(null);
  const [kind, setKind] = useState<AdjustmentKind>("scholarship");
  const [adjAmount, setAdjAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmWaive, setConfirmWaive] = useState(false);
  // tabs (Setup is admin-only; the server enforces regardless)
  const [isAdmin, setIsAdmin] = useState(false);
  // accountant/admin manage; the principal is a read-only fee viewer.
  const [canManage, setCanManage] = useState(false);
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
  // student slide-over
  const [viewing, setViewing] = useState<FeeInvoiceView | null>(null);

  useEffect(() => {
    api.session().then((me) => {
      setIsAdmin(me.roles.includes("admin"));
      const manage = me.roles.includes("admin") || me.roles.includes("accountant");
      setCanManage(manage);
      if (!manage) setTab("collections"); // principal lands on the read-only overview
    }).catch(() => undefined);
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
    setInvoicesLoading(true);
    setInvoicesError(false);
    try {
      setInvoices((await api.feesSectionInvoices(sectionId, year)).invoices);
    } catch {
      setInvoices([]);
      setInvoicesError(true);
    } finally {
      setInvoicesLoading(false);
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
    setPaymentIdempotencyKey(crypto.randomUUID());
  }

  async function recordPayment() {
    const paise = paying ? parseRupees(amount) : null;
    if (!paying || paise === null) return;
    setSaving(true);
    try {
      const { payment, invoice } = await api.feesRecordPayment({
        invoiceId: paying.id,
        amountPaise: paise,
        mode,
        ...(payRef.trim() !== "" ? { ref: payRef.trim() } : {}),
        idempotencyKey: paymentIdempotencyKey,
      });
      applyInvoice(invoice);
      setPaying(invoice);
      setReceipt(payment);
      toast.push({ status: "good", message: `Receipt #${payment.receiptNo} issued.` });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't record the payment." });
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
      toast.push({ status: "good", message: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} recorded.` });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't record the adjustment." });
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
      toast.push({ status: "good", message: `Head "${head.name}" added.` });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't add the head." });
    } finally {
      setSaving(false);
    }
  }

  async function removeHead(head: FeeHeadView) {
    try {
      await api.feesDeleteHead(head.id);
      setHeads((rows) => rows.filter((row) => row.id !== head.id));
      toast.push({ status: "good", message: `Head "${head.name}" deleted.` });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't delete — still used by a structure." });
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
      toast.push({ status: "good", message: "Structure set." });
      setStructOpen(false);
      setStructAmount("");
      await loadStructures();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't set the structure." });
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
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't start the run." });
    }
  }

  async function loadSummary() {
    if (collegeId === null) return;
    try {
      setSummary(await api.feesCollectionSummary(collegeId, from, to));
    } catch (caught) {
      setSummary(null);
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't load collections." });
    }
  }

  function toDrawerStudent(row: FeeInvoiceView, idx: number): DrawerStudent {
    return {
      studentId: row.studentId,
      initials: initials(row.studentName),
      gradient: AVATARS[idx % AVATARS.length]!.gradient,
      ink: AVATARS[idx % AVATARS.length]!.ink,
      rollNo: row.admissionNo,
      name: row.studentName,
      section: (sections ?? []).find((section) => section.id === row.sectionId)?.label ?? "",
      // A fee invoice carries no student LIFECYCLE status; do not feed the
      // invoice's payment status (paid/waived/pending) into the drawer's
      // lifecycle-status field. Fees is a canManage=false view — status isn't editable here.
      status: "",
      pct: null,
      attended: 0,
      total: 0,
      lastMark: null,
      backlogs: 0,
      flags: { backlog: false, yb: false },
      phone: null,
      guardianName: null,
      guardianPhone: null,
      dob: null,
    };
  }

  if (sections === null) return <Skeleton height={16} />;

  const q = query.trim().toLowerCase();
  const visible = q === ""
    ? invoices
    : invoices.filter(
        (row) => row.studentName.toLowerCase().includes(q) || row.admissionNo.toLowerCase().includes(q),
      );

  const ledgerColumns: TableColumn<LedgerRow>[] = [
    { key: "student", header: "Student" },
    { key: "head", header: "Head" },
    { key: "due", header: "Due on", figure: true },
    { key: "amount", header: "Amount", figure: true, align: "right" },
    { key: "paid", header: "Paid", figure: true, align: "right" },
    { key: "dues", header: "Dues", figure: true, align: "right" },
    { key: "status", header: "Status" },
    { key: "actions", header: "", align: "right" },
  ];
  const ledgerRows: LedgerRow[] = visible.map((row) => ({
    student: (
      <span>
        <strong>{row.studentName}</strong>
        <span className={`num ${styles.admissionNo}`}>{row.admissionNo}</span>
      </span>
    ),
    head: row.headName,
    due: <span className="num">{row.dueOn}</span>,
    amount: <span className="num">{formatPaise(row.amountPaise)}</span>,
    paid: <span className="num">{formatPaise(row.paidPaise)}</span>,
    dues: <strong className="num">{formatPaise(row.duesPaise)}</strong>,
    status: invoiceBadge(row, today),
    actions: (
      <span className={styles.actionsRow}>
        <Button variant="ghost" onClick={() => setViewing(row)}>View</Button>
        {canManage ? (
          <>
            {row.status !== "waived" && row.status !== "paid" ? (
              <Button variant="ghost" onClick={() => openPayment(row)}>Take payment</Button>
            ) : null}
            {row.status !== "waived" ? (
              <Button variant="ghost" onClick={() => openAdjustment(row)}>Adjust</Button>
            ) : null}
          </>
        ) : null}
      </span>
    ),
  }));

  const structureColumns: TableColumn<StructureRow>[] = [
    { key: "head", header: "Head" },
    { key: "inst", header: "Inst.", figure: true, align: "right" },
    { key: "amount", header: "Amount", figure: true, align: "right" },
    { key: "due", header: "Due on", figure: true },
  ];
  const structureRows: StructureRow[] = structures.map((row) => ({
    head: <strong>{row.headName}</strong>,
    inst: <span className="num">{row.installmentNo}</span>,
    amount: <span className="num">{formatPaise(row.amountPaise)}</span>,
    due: <span className="num">{row.dueOn}</span>,
  }));

  const modeColumns: TableColumn<ModeRow>[] = [
    { key: "mode", header: "Mode" },
    { key: "count", header: "Receipts", figure: true, align: "right" },
    { key: "total", header: "Collected", figure: true, align: "right" },
  ];
  const modeRows: ModeRow[] = (summary?.byMode ?? []).map((row) => ({
    mode: <StatusBadge status="neutral">{row.mode}</StatusBadge>,
    count: <span className="num">{row.count}</span>,
    total: <strong className="num">{formatPaise(row.totalPaise)}</strong>,
  }));

  const defaulterColumns: TableColumn<DefaulterRow>[] = [
    { key: "student", header: "Student" },
    { key: "head", header: "Head" },
    { key: "due", header: "Due on", figure: true },
    { key: "dues", header: "Dues", figure: true, align: "right" },
  ];
  const defaulterRows: DefaulterRow[] = defaulters.map((row) => ({
    student: (
      <span>
        <strong>{row.studentName}</strong>
        <span className={`num ${styles.admissionNo}`}>{row.admissionNo}</span>
      </span>
    ),
    head: row.headName,
    due: <span className="num">{row.dueOn}</span>,
    dues: <strong className="num">{formatPaise(row.duesPaise)}</strong>,
  }));

  return (
    <>
      <PageHeader
        eyebrow={`Fees · ${year}`}
        title="Fee counter"
        lede="Open a section's ledger, take a payment, hand over the receipt."
        help={<HelpButton slug="fees" />}
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
        <div role="tabpanel" id="panel-counter" aria-labelledby="tab-counter" tabIndex={0}>
      <div className={styles.pickerRow}>
        <Select
          id="fee-section" label="Section" className={styles.wide}
          value={sectionId} onChange={(event) => setSectionId(event.target.value)}
          options={[{ value: "", label: "Pick a section…" }, ...sections.map((section) => ({ value: section.id, label: section.label }))]}
        />
        <Input
          id="fee-query" label="Find student" placeholder="Name or admission no." className={styles.queryWide}
          value={query} onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <section className="section" aria-label="Invoice ledger">
        {sectionId === "" ? (
          <EmptyState title="Pick a section to open its ledger." body="Every invoice for the year appears as a ruled row." />
        ) : (
          <AsyncState
            loading={invoicesLoading}
            error={invoicesError}
            onRetry={() => void loadInvoices()}
            isEmpty={visible.length === 0}
            empty={<EmptyState title={`No invoices for ${year}.`} body="Invoices appear once they are generated for this section's class." />}
          >
            <Table columns={ledgerColumns} rows={ledgerRows} scrollable={{ label: "Invoice ledger" }} />
          </AsyncState>
        )}
      </section>

      <section className="section" aria-label="Outstanding dues">
        <div className="section-head"><h2>Outstanding dues</h2></div>
        <AsyncState
          loading={false}
          error={false}
          isEmpty={defaulters.length === 0}
          empty={<EmptyState title={`No outstanding dues for ${year}.`} body="Every generated invoice is settled." />}
        >
          <Table columns={defaulterColumns} rows={defaulterRows} />
        </AsyncState>
      </section>
        </div>
      ) : null}

      {tab === "setup" && isAdmin ? (
        <div role="tabpanel" id="panel-setup" aria-labelledby="tab-setup" tabIndex={0}>
          <section className="section" aria-label="Fee heads">
            <div className="section-head"><h2>Fee heads</h2></div>
            <div className={styles.headsList}>
              {heads.map((head) => (
                <div key={head.id} className={styles.headRow}>
                  <span>{head.name}</span>
                  <Button variant="ghost" onClick={() => void removeHead(head)}>Delete</Button>
                </div>
              ))}
              {heads.length === 0 ? (
                <p className={styles.headsEmpty}>No heads yet — add Tuition, Library, Lab…</p>
              ) : null}
            </div>
            <div className={styles.addHeadRow}>
              <Input id="head-name" label="New head" placeholder="e.g. Tuition" value={newHead} onChange={(event) => setNewHead(event.target.value)} />
              <Button onClick={() => void addHead()} loading={saving} disabled={newHead.trim() === ""}>Add head</Button>
            </div>
          </section>

          <section className="section" aria-label="Class structures">
            <div className="section-head">
              <h2>Class structures · {year}</h2>
              <span className={styles.actionsRow}>
                <Button variant="ghost" onClick={() => setStructOpen(true)} disabled={classId === "" || heads.length === 0}>Set structure</Button>
                <Button onClick={() => setConfirmGenerate(true)} disabled={classId === "" || structures.length === 0}>Generate invoices</Button>
              </span>
            </div>
            <Select
              id="fee-class" label="Class" className={styles.structPicker}
              value={classId} onChange={(event) => setClassId(event.target.value)}
              options={[{ value: "", label: "Pick a class…" }, ...classes.map((cls) => ({ value: cls.id, label: cls.label }))]}
            />
            {run ? (
              <p className={`num ${styles.runStatus}`} aria-live="polite">
                {run.status === "failed"
                  ? `Generation failed: ${run.error ?? "unknown error"}`
                  : run.status === "completed"
                    ? `Generated — created ${run.invoicesCreated} · skipped ${run.invoicesSkipped}`
                    : `Generating… created ${run.invoicesCreated} · skipped ${run.invoicesSkipped}`}
              </p>
            ) : null}
            {classId === "" ? (
              <EmptyState title="Pick a class to see its fee structures." body="One row per head, year and installment." />
            ) : (
              <AsyncState
                loading={false}
                error={false}
                isEmpty={structures.length === 0}
                empty={<EmptyState title={`No structures for ${year}.`} body="Set one with the button above — invoices generate from structures." />}
              >
                <Table columns={structureColumns} rows={structureRows} />
              </AsyncState>
            )}
          </section>
        </div>
      ) : null}

      {tab === "collections" ? (
        <div role="tabpanel" id="panel-collections" aria-labelledby="tab-collections" tabIndex={0}>
        <section className="section" aria-label="Collections">
          <div className={styles.collectionsRow}>
            <Input id="col-from" label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <Input id="col-to" label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            <Button onClick={() => void loadSummary()}>Show collections</Button>
          </div>
          {summary === null ? (
            <EmptyState title="Pick a range and show collections." body="Totals come from issued receipts — reconcile the cash box against them." />
          ) : (
            <>
              <section className={`stats ${styles.statsSection}`} aria-label="Collection totals">
                <StatTile value={formatPaise(summary.totalPaise)} label="Collected" sub={`${summary.from} → ${summary.to}`} />
                <StatTile value={String(summary.byMode.reduce((n, m) => n + m.count, 0))} label="Receipts issued" />
              </section>
              <AsyncState
                loading={false}
                error={false}
                isEmpty={summary.byMode.length === 0}
                empty={<EmptyState title="No collections in this range." body="Payments recorded at the counter appear here." />}
              >
                <Table columns={modeColumns} rows={modeRows} />
              </AsyncState>
            </>
          )}
        </section>
        </div>
      ) : null}

      {/* RECORD PAYMENT → COUNTERFOIL */}
      <Modal
        open={paying !== null}
        onClose={() => setPaying(null)}
        title={receipt ? "Payment recorded" : `Take payment — ${paying?.studentName ?? ""}`}
        footer={
          receipt ? (
            <>
              <Button variant="ghost" onClick={() => window.print()}>Print receipt</Button>
              <Button onClick={() => setPaying(null)}>Done</Button>
            </>
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
          <div className="receipt-print">
            <Counterfoil payment={receipt} invoice={paying} />
          </div>
        ) : (
          <div className={styles.formGrid}>
            <p className={styles.payingInfo}>
              {paying?.headName} · dues <strong className="num">{formatPaise(paying?.duesPaise ?? 0)}</strong>
            </p>
            <div className={styles.formRow}>
              <Input
                id="pay-amount"
                label="Amount (₹)"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setPaymentIdempotencyKey(crypto.randomUUID());
                }}
                className={styles.amountField}
              />
              <Select
                id="pay-mode" label="Mode" value={mode} onChange={(event) => {
                  setMode(event.target.value as PaymentMode);
                  setPaymentIdempotencyKey(crypto.randomUUID());
                }}
                options={MODES.map((m) => ({ value: m, label: m }))}
              />
            </div>
            <Input
              id="pay-ref"
              label="Reference (optional)"
              placeholder="UPI ref / cheque no."
              value={payRef}
              onChange={(event) => {
                setPayRef(event.target.value);
                setPaymentIdempotencyKey(crypto.randomUUID());
              }}
            />
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
        <div className={styles.formGrid}>
          <div className={styles.formRow}>
            <Select
              id="adj-kind" label="Kind" value={kind} onChange={(event) => setKind(event.target.value as AdjustmentKind)}
              options={KINDS.map((k) => ({ value: k, label: k }))}
            />
            <Input id="adj-amount" label="Amount (₹)" inputMode="decimal" value={adjAmount} onChange={(event) => setAdjAmount(event.target.value)} className={styles.amountField} />
          </div>
          <Input id="adj-reason" label="Reason" placeholder="Why this adjustment is being made" value={reason} onChange={(event) => setReason(event.target.value)} />
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
        <div className={styles.formGrid}>
          <Select
            id="struct-head" label="Head" value={structHeadId} onChange={(event) => setStructHeadId(event.target.value)}
            options={[{ value: "", label: "Pick a head…" }, ...heads.map((head) => ({ value: head.id, label: head.name }))]}
          />
          <div className={styles.formRow}>
            <Input id="struct-amount" label="Amount (₹)" inputMode="decimal" value={structAmount} onChange={(event) => setStructAmount(event.target.value)} className={styles.amountField} />
            <Input id="struct-due" label="Due on" type="date" value={structDue} onChange={(event) => setStructDue(event.target.value)} />
            <Input id="struct-inst" label="Installment" type="number" min={1} max={12} value={structInst} onChange={(event) => setStructInst(event.target.value)} className={styles.instField} />
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmGenerate}
        onClose={() => setConfirmGenerate(false)}
        title="Generate invoices"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmGenerate(false)}>Cancel</Button>
            <Button onClick={() => void startGenerate()}>Generate</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>
          Generate invoices for {classes.find((cls) => cls.id === classId)?.label ?? ""} · {year}? Students already invoiced are skipped, so re-running is safe.
        </p>
      </Modal>

      <Modal
        open={confirmWaive}
        onClose={() => setConfirmWaive(false)}
        title="Waive this invoice"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmWaive(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void submitAdjustment()}>Waive</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>
          Waive {formatPaise(parseRupees(adjAmount) ?? 0)} for {adjusting?.studentName ?? ""}? No further payments will be accepted on a waived invoice.
        </p>
      </Modal>

      <StudentSlideOver
        student={viewing ? toDrawerStudent(viewing, visible.indexOf(viewing)) : null}
        canManage={false}
        onClose={() => setViewing(null)}
      />
    </>
  );
}
