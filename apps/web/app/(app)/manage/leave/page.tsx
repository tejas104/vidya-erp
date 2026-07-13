"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type LeaveRequestView } from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { Badge } from "@/ui/Badge";
import { Card } from "@/ui/Card";
import { DataTable, type Column } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

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

export default function LeavePage() {
  const toast = useToast();
  const [isApprover, setIsApprover] = useState(false);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [mine, setMine] = useState<LeaveRequestView[] | null>(null);
  const [pending, setPending] = useState<LeaveRequestView[]>([]);

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
      if (alive) setMine([]);
    });
    return () => {
      alive = false;
    };
  }, [refetch]);

  async function approve(row: LeaveRequestView) {
    try {
      await api.lvsDecide(row.id, { status: "approved" });
      await refetch(isApprover);
      toast.show("Leave approved.", "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't approve.", "danger");
    }
  }

  async function confirmReject() {
    if (!doomed || note.trim() === "") return;
    setDeciding(true);
    try {
      await api.lvsDecide(doomed.id, { status: "rejected", note: note.trim() });
      await refetch(isApprover);
      toast.show("Leave rejected.", "good");
      setDoomed(null);
      setNote("");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't reject.", "danger");
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
      toast.show("Leave request submitted.", "good");
    } catch (caught) {
      if (caught instanceof ApiError && caught.message.includes("choose one of your departments")) {
        setNeedsDept(true);
      } else {
        toast.show(caught instanceof ApiError ? caught.message : "Couldn't submit.", "danger");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (mine === null) return <Skeleton lines={5} />;

  const approvalColumns: Column<LeaveRequestView>[] = [
    { key: "teacher", header: "Teacher", render: (row) => <strong>{row.teacherName}</strong> },
    { key: "dates", header: "Dates", render: (row) => <span className="num">{row.fromOn} → {row.toOn}</span> },
    { key: "kind", header: "Kind", render: (row) => row.kind },
    { key: "reason", header: "Reason", render: (row) => row.reason },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button onClick={() => void approve(row)}>Approve</Button>
          <Button variant="danger" onClick={() => { setDoomed(row); setNote(""); }}>Reject</Button>
        </div>
      ),
    },
  ];

  const mineColumns: Column<LeaveRequestView>[] = [
    { key: "dates", header: "Dates", render: (row) => <span className="num">{row.fromOn} → {row.toOn}</span> },
    { key: "kind", header: "Kind", render: (row) => row.kind },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <>
          <Badge tone={statusTone(row.status)}>{row.status}</Badge>
          {row.decisionNote !== null ? (
            <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 4 }}>{row.decisionNote}</div>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Leave"
        title="Staff leave"
        lede="Apply for leave and track your requests. Approvers see a queue below."
        actions={<Button onClick={() => setApplying(true)}>Apply for leave</Button>}
      />

      {isApprover && pending.length > 0 ? (
        <section className="section" aria-label="Approvals">
          <div className="section-head"><h2>Waiting on you</h2></div>
          <Card>
            <DataTable columns={approvalColumns} rows={pending} rowKey={(row) => row.id} />
          </Card>
        </section>
      ) : null}

      <section className="section" aria-label="My requests">
        <div className="section-head"><h2>My requests</h2></div>
        {mine.length === 0 ? (
          <EmptyState title="You haven't applied for any leave." />
        ) : (
          <Card>
            <DataTable columns={mineColumns} rows={mine} rowKey={(row) => row.id} />
          </Card>
        )}
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
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="From" htmlFor="lvs-from">
            <input id="lvs-from" type="date" value={fromOn} onChange={(event) => setFromOn(event.target.value)} />
          </Field>
          <Field label="To" htmlFor="lvs-to">
            <input id="lvs-to" type="date" value={toOn} onChange={(event) => setToOn(event.target.value)} />
          </Field>
          <Field label="Kind" htmlFor="lvs-kind">
            <select id="lvs-kind" value={kind} onChange={(event) => setKind(event.target.value as (typeof KINDS)[number])}>
              {KINDS.map((k) => (<option key={k} value={k}>{k}</option>))}
            </select>
          </Field>
          <Field label="Reason" htmlFor="lvs-reason">
            <textarea id="lvs-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </Field>
          {needsDept ? (
            <Field label="Department" htmlFor="lvs-dept" hint="You belong to more than one department — pick which this leave is for.">
              <select id="lvs-dept" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
                <option value="">Pick a department…</option>
                {departmentIds.map((id) => (<option key={id} value={id}>{id}</option>))}
              </select>
            </Field>
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
        <Field label="Note" htmlFor="lvs-note">
          <textarea id="lvs-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
        </Field>
      </Modal>
    </>
  );
}
