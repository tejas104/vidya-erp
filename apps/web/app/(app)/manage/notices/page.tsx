"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type NoticeView } from "@/ui/api";
import { ago } from "@/ui/time";
import { AsyncState } from "@/ui/AsyncState";
import {
  useToast, Button, Input, Select, Modal, Table, StatusBadge, EmptyState, Skeleton, PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type AudienceOption = { value: string; label: string };

/** scheduled → live → expired, derived client-side from the publish window. */
function noticeBadge(notice: NoticeView, now: string): ReactNode {
  if (notice.publishAt > now) return <StatusBadge status="warn">scheduled</StatusBadge>;
  if (notice.expiresAt !== null && notice.expiresAt <= now) return <StatusBadge status="neutral">expired</StatusBadge>;
  return <StatusBadge status="good">live</StatusBadge>;
}

type NoticeRow = {
  title: ReactNode; aud: ReactNode; created: ReactNode; from: ReactNode; to: ReactNode;
  status: ReactNode; actions: ReactNode;
};

export default function NoticesPage() {
  const toast = useToast();
  const now = useMemo(() => new Date().toISOString(), []);
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [audiences, setAudiences] = useState<AudienceOption[] | null>(null);
  const [notices, setNotices] = useState<NoticeView[]>([]);
  const [noticesLoading, setNoticesLoading] = useState(false);
  const [noticesError, setNoticesError] = useState(false);
  const [saving, setSaving] = useState(false);
  // compose modal
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("college");
  const [publishOn, setPublishOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [doomed, setDoomed] = useState<NoticeView | null>(null);

  const loadNotices = useCallback(async (id: string) => {
    setNoticesLoading(true);
    setNoticesError(false);
    try {
      setNotices((await api.ntcList(id)).notices);
    } catch {
      setNoticesError(true);
    } finally {
      setNoticesLoading(false);
    }
  }, []);

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
        void loadNotices(college.id);
      })
      .catch(() => setAudiences([]));
  }, [loadNotices]);

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
      toast.push({ status: "good", message: created.publishAt > now ? "Notice scheduled." : "Notice published." });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't publish." });
    } finally {
      setSaving(false);
    }
  }

  async function removeNotice() {
    if (!doomed) return;
    try {
      await api.ntcDelete(doomed.id);
      setNotices((rows) => rows.filter((row) => row.id !== doomed.id));
      toast.push({ status: "good", message: "Notice taken off the board." });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't delete." });
    } finally {
      setDoomed(null);
    }
  }

  if (audiences === null) return <Skeleton height={16} />;

  const columns: TableColumn<NoticeRow>[] = [
    { key: "title", header: "Notice" },
    { key: "aud", header: "Audience" },
    { key: "created", header: "Created", figure: true },
    { key: "from", header: "Publish", figure: true },
    { key: "to", header: "Expires", figure: true },
    { key: "status", header: "Status" },
    { key: "actions", header: "", align: "right" },
  ];
  const rows: NoticeRow[] = notices.map((row) => ({
    title: (
      <span>
        <strong>{row.title}</strong>
        <span className={styles.snippet}>{row.body.length > 90 ? `${row.body.slice(0, 90)}…` : row.body}</span>
      </span>
    ),
    aud: <StatusBadge status="neutral">{row.audienceLabel}</StatusBadge>,
    created: <span className="num">{ago(row.createdAt)}</span>,
    from: <span className="num">{row.publishAt.slice(0, 10)}</span>,
    to: <span className="num">{row.expiresAt?.slice(0, 10) ?? "—"}</span>,
    status: noticeBadge(row, now),
    actions: <Button variant="danger" onClick={() => setDoomed(row)}>Delete</Button>,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Notices"
        title="The noticeboard"
        lede="Publish to the whole college, the staff room, or one department or class — readers see only what's addressed to them."
        actions={<Button onClick={() => setComposing(true)}>New notice</Button>}
      />

      <section className="section" aria-label="All notices">
        <AsyncState
          loading={noticesLoading}
          error={noticesError}
          onRetry={() => { if (collegeId !== null) void loadNotices(collegeId); }}
          isEmpty={notices.length === 0}
          empty={<EmptyState title="Nothing on the board." body="Publish the first notice with the button above." />}
        >
          <Table columns={columns} rows={rows} />
        </AsyncState>
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
        <div className={styles.formGrid}>
          <Input id="ntc-title" label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <div className="field">
            <label htmlFor="ntc-body">Body</label>
            <textarea id="ntc-body" rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
          </div>
          <Select
            id="ntc-aud" label="Audience" value={audience} onChange={(event) => setAudience(event.target.value)}
            options={audiences.map((option) => ({ value: option.value, label: option.label }))}
          />
          <div className={styles.formRow}>
            <Input id="ntc-from" label="Publish on (blank = now)" type="date" value={publishOn} onChange={(event) => setPublishOn(event.target.value)} />
            <Input id="ntc-to" label="Expires on (optional)" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        open={doomed !== null}
        onClose={() => setDoomed(null)}
        title="Take this notice down"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDoomed(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void removeNotice()}>Delete</Button>
          </>
        }
      >
        <p className={styles.confirmMessage}>
          Delete &quot;{doomed?.title ?? ""}&quot;? Readers stop seeing it immediately.
        </p>
      </Modal>
    </>
  );
}
