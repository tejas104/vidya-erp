"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type LeaveRequestView } from "@/ui/api";
import {
  useToast,
  Button,
  Input,
  Select,
  Modal,
  Table,
  StatusBadge,
  Card,
  EmptyState,
  Skeleton,
  PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const KINDS = ["casual", "sick", "duty"] as const;

function statusTone(status: LeaveRequestView["status"]): "warn" | "good" | "danger" {
  if (status === "pending") return "warn";
  if (status === "approved") return "good";
  return "danger";
}

/** The teacher's own department grants — populated only if the server rejects a
 * dept-less apply, so the multi-department select stays untested-path-simple. */
function departmentIdsOf(grants: unknown[]): string[] {
  const ids = new Set<string>();
  for (const grant of grants) {
    const departmentId = (grant as { org?: { departmentId?: string } })?.org?.departmentId;
    if (typeof departmentId === "string") ids.add(departmentId);
  }
  return [...ids];
}

type ApprovalRow = { teacher: React.ReactNode; dates: React.ReactNode; kind: React.ReactNode; reason: React.ReactNode; actions: React.ReactNode };
type MineRow = { dates: React.ReactNode; kind: React.ReactNode; status: React.ReactNode };

export default function LeavePage() {
  const toast = useToast();
  const [isApprover, setIsApprover] = useState(false);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [mine, setMine] = useState<LeaveRequestView[] | null>(null);
  const [pending, setPending] = useState<LeaveRequestView[]>([]);
  const [failed, setFailed] = useState(false);

  // apply modal
  const [applying, setApplying] = useState(false);
  const [fromOn, setFromOn] = useState("");
  const [toOn, setToOn] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("casual");
  const [reason, setReason] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [needsDept, setNeedsDept] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // reject modal
  const [doomed, setDoomed] = useState<LeaveRequestView | null>(null);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  const refetch = useCallback(async (approver: boolean) => {
    const [mineResult, pendingResult] = await Promise.all([
      api.lvsMine(),
      approver ? api.lvsPending() : Promise.resolve({ requests: [] }),
    ]);
    setMine(mineResult.requests);
    setPending(pendingResult.requests);
  }, []);

  useEffect(() => {
    let alive = true;
    api.session().then(async (me) => {
      if (!alive) return;
      const approver = me.roles.includes("hod") || me.roles.includes("principal") || me.roles.includes("admin");
      setIsApprover(approver);
      setDepartmentIds(departmentIdsOf(me.grants));
      await refetch(approver);
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [refetch]);

  async function approve(row: LeaveRequestView) {
    try {
      await api.lvsDecide(row.id, { status: "approved" });
      await refetch(isApprover);
      toast.push({ status: "good", message: "Leave approved." });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't approve." });
    }
  }

  async function confirmReject() {
    if (!doomed || note.trim() === "") return;
    setDeciding(true);
    try {
      await api.lvsDecide(doomed.id, { status: "rejected", note: note.trim() });
      await refetch(isApprover);
      toast.push({ status: "good", message: "Leave rejected." });
      setDoomed(null);
      setNote("");
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't reject." });
    } finally {
      setDeciding(false);
    }
  }

  async function submitApply() {
    if (fromOn === "" || toOn === "" || reason.trim() === "") return;
    setSubmitting(true);
    try {
      await api.lvsApply({
        fromOn, toOn, kind, reason: reason.trim(),
        ...(departmentId !== "" ? { departmentId } : {}),
      });
      setApplying(false);
      setFromOn("");
      setToOn("");
      setReason("");
      setDepartmentId("");
      setNeedsDept(false);
      await refetch(isApprover);
      toast.push({ status: "good", message: "Leave request submitted." });
    } catch (caught) {
      if (caught instanceof ApiError && caught.message.includes("choose one of your departments")) {
        setNeedsDept(true);
      } else {
        toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't submit." });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const approvalColumns: TableColumn<ApprovalRow>[] = [
    { key: "teacher", header: "Teacher" },
    { key: "dates", header: "Dates", figure: true },
    { key: "kind", header: "Kind" },
    { key: "reason", header: "Reason" },
    { key: "actions", header: "" },
  ];
  const approvalRows: ApprovalRow[] = pending.map((row) => ({
    teacher: <strong>{row.teacherName}</strong>,
    dates: <span className="num">{row.fromOn} → {row.toOn}</span>,
    kind: row.kind,
    reason: row.reason,
    actions: (
      <div className={styles.rowActions}>
        <Button onClick={() => void approve(row)}>Approve</Button>
        <Button variant="danger" onClick={() => { setDoomed(row); setNote(""); }}>Reject</Button>
      </div>
    ),
  }));

  const mineColumns: TableColumn<MineRow>[] = [
    { key: "dates", header: "Dates", figure: true },
    { key: "kind", header: "Kind" },
    { key: "status", header: "Status" },
  ];
  const mineRows: MineRow[] = (mine ?? []).map((row) => ({
    dates: <span className="num">{row.fromOn} → {row.toOn}</span>,
    kind: row.kind,
    status: (
      <>
        <StatusBadge status={statusTone(row.status)}>{row.status}</StatusBadge>
        {row.decisionNote !== null ? <div className={styles.decisionNote}>{row.decisionNote}</div> : null}
      </>
    ),
  }));

  return (
    <>
      <PageHeader
        title="Staff leave"
        actions={<Button onClick={() => setApplying(true)}>Apply for leave</Button>}
      />
      <p className={styles.lede}>Apply for leave and track your requests. Approvers see a queue below.</p>

      {isApprover && pending.length > 0 ? (
        <section className="section" aria-label="Approvals">
          <div className="section-head"><h2>Waiting on you</h2></div>
          <Card>
            <Table columns={approvalColumns} rows={approvalRows} />
          </Card>
        </section>
      ) : null}

      <section className="section" aria-label="My requests">
        <div className="section-head"><h2>My requests</h2></div>
        <AsyncState
          loading={mine === null && !failed}
          error={failed}
          onRetry={() => void refetch(isApprover)}
          isEmpty={mine !== null && mine.length === 0}
          empty={<EmptyState title="You haven't applied for any leave." />}
        >
          <Card>
            <Table columns={mineColumns} rows={mineRows} />
          </Card>
        </AsyncState>
      </section>

      <Modal
        open={applying}
        onClose={() => setApplying(false)}
        title="Apply for leave"
        footer={
          <>
            <Button variant="ghost" onClick={() => setApplying(false)}>Cancel</Button>
            <Button
              onClick={() => void submitApply()}
              loading={submitting}
              disabled={fromOn === "" || toOn === "" || reason.trim() === "" || (needsDept && departmentId === "")}
            >
              Submit
            </Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <Input id="lvs-from" label="From" type="date" value={fromOn} onChange={(event) => setFromOn(event.target.value)} />
          <Input id="lvs-to" label="To" type="date" value={toOn} onChange={(event) => setToOn(event.target.value)} />
          <Select
            id="lvs-kind"
            label="Kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as (typeof KINDS)[number])}
            options={KINDS.map((k) => ({ value: k, label: k }))}
          />
          <div className={styles.field}>
            <label htmlFor="lvs-reason" className={styles.label}>Reason</label>
            <textarea id="lvs-reason" className={styles.textarea} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </div>
          {needsDept ? (
            <Select
              id="lvs-dept"
              label="Department"
              hint="You belong to more than one department — pick which this leave is for."
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              options={[{ value: "", label: "Pick a department…" }, ...departmentIds.map((id) => ({ value: id, label: id }))]}
            />
          ) : null}
        </div>
      </Modal>

      <Modal
        open={doomed !== null}
        onClose={() => setDoomed(null)}
        title="Reject leave request"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDoomed(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => void confirmReject()}
              loading={deciding}
              disabled={note.trim() === ""}
            >
              Confirm reject
            </Button>
          </>
        }
      >
        <div className={styles.field}>
          <label htmlFor="lvs-note" className={styles.label}>Note</label>
          <textarea id="lvs-note" className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
        </div>
      </Modal>
    </>
  );
}
