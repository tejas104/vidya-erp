"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type NoticeView } from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

type AudienceOption = { value: string; label: string };

/** scheduled → live → expired, derived client-side from the publish window. */
function StatusBadge({ notice, now }: { notice: NoticeView; now: string }) {
  if (notice.publishAt > now) return <Badge tone="warn">scheduled</Badge>;
  if (notice.expiresAt !== null && notice.expiresAt <= now) return <Badge>expired</Badge>;
  return <Badge tone="good">live</Badge>;
}

export default function NoticesPage() {
  const toast = useToast();
  const now = useMemo(() => new Date().toISOString(), []);
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [audiences, setAudiences] = useState<AudienceOption[] | null>(null);
  const [notices, setNotices] = useState<NoticeView[]>([]);
  const [saving, setSaving] = useState(false);
  // compose modal
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("college");
  const [publishOn, setPublishOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [doomed, setDoomed] = useState<NoticeView | null>(null);

  useEffect(() => {
    api.colleges()
      .then(async ({ colleges }) => {
        const college = colleges[0];
        if (!college) { setAudiences([]); return; }
        setCollegeId(college.id);
        const tree = await api.collegeTree(college.id);
        const options: AudienceOption[] = [
          { value: "college", label: "College-wide" },
          { value: "staff", label: "Staff" },
          { value: "students", label: "Students" },
        ];
        for (const dep of tree.departments) {
          options.push({ value: `department:${dep.id}`, label: `Department — ${dep.name}` });
          for (const cls of dep.classes) options.push({ value: `class:${cls.id}`, label: `Class — ${cls.name}` });
        }
        setAudiences(options);
        api.ntcList(college.id).then((r) => setNotices(r.notices)).catch(() => setNotices([]));
      })
      .catch(() => setAudiences([]));
  }, []);

  async function publish() {
    if (collegeId === null || title.trim() === "" || body.trim() === "") return;
    setSaving(true);
    try {
      const created = await api.ntcCreate({
        collegeId, audience, title, body,
        ...(publishOn !== "" ? { publishAt: `${publishOn}T00:00:00.000Z` } : {}),
        ...(expiresOn !== "" ? { expiresAt: `${expiresOn}T00:00:00.000Z` } : {}),
      });
      setNotices((rows) => [created, ...rows]);
      setComposing(false);
      setTitle("");
      setBody("");
      setPublishOn("");
      setExpiresOn("");
      toast.show(created.publishAt > now ? "Notice scheduled." : "Notice published.", "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't publish.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function removeNotice() {
    if (!doomed) return;
    try {
      await api.ntcDelete(doomed.id);
      setNotices((rows) => rows.filter((row) => row.id !== doomed.id));
      toast.show("Notice taken off the board.", "good");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't delete.", "danger");
    } finally {
      setDoomed(null);
    }
  }

  if (audiences === null) return <Skeleton lines={5} />;

  const columns: Column<NoticeView>[] = [
    {
      key: "title", header: "Notice",
      render: (row) => (
        <span>
          <strong>{row.title}</strong>
          <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-3)" }}>
            {row.body.length > 90 ? `${row.body.slice(0, 90)}…` : row.body}
          </span>
        </span>
      ),
    },
    { key: "aud", header: "Audience", render: (row) => <Badge>{row.audienceLabel}</Badge> },
    { key: "from", header: "Publish", render: (row) => <span className="num">{row.publishAt.slice(0, 10)}</span> },
    { key: "to", header: "Expires", render: (row) => <span className="num">{row.expiresAt?.slice(0, 10) ?? "—"}</span> },
    { key: "status", header: "Status", render: (row) => <StatusBadge notice={row} now={now} /> },
    {
      key: "actions", header: "", align: "right",
      render: (row) => <Button variant="danger" onClick={() => setDoomed(row)}>Delete</Button>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Notices"
        title="The noticeboard"
        lede="Publish to the whole college, the staff room, or one department or class — readers see only what's addressed to them."
        actions={<Button onClick={() => setComposing(true)}>New notice</Button>}
      />

      <section className="section" aria-label="All notices">
        <DataTable
          columns={columns} rows={notices} rowKey={(row) => row.id}
          empty={{ title: "Nothing on the board.", message: "Publish the first notice with the button above." }}
        />
      </section>

      <Modal
        open={composing}
        onClose={() => setComposing(false)}
        title="New notice"
        footer={
          <>
            <Button variant="ghost" onClick={() => setComposing(false)}>Cancel</Button>
            <Button onClick={() => void publish()} loading={saving} disabled={title.trim() === "" || body.trim() === ""}>
              Publish
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Title" htmlFor="ntc-title">
            <input id="ntc-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Body" htmlFor="ntc-body">
            <textarea id="ntc-body" rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
          <Field label="Audience" htmlFor="ntc-aud">
            <select id="ntc-aud" value={audience} onChange={(event) => setAudience(event.target.value)}>
              {audiences.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </Field>
          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <Field label="Publish on (blank = now)" htmlFor="ntc-from">
              <input id="ntc-from" type="date" value={publishOn} onChange={(event) => setPublishOn(event.target.value)} />
            </Field>
            <Field label="Expires on (optional)" htmlFor="ntc-to">
              <input id="ntc-to" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={doomed !== null}
        title="Take this notice down"
        message={`Delete "${doomed?.title ?? ""}"? Readers stop seeing it immediately.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => void removeNotice()}
        onCancel={() => setDoomed(null)}
      />
    </>
  );
}
