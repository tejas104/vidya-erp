"use client";
import { useEffect, useState } from "react";
import { api, type NoticeView, type NoticeKind } from "@/ui/api";
import { PageHeader } from "@/ui/PageHeader";
import { Skeleton } from "@/ui/Skeleton";
import { EmptyState } from "@/ui/EmptyState";

export const dynamic = "force-dynamic";

const KIND_TONE: Record<NoticeKind, string> = {
  holiday: "var(--good)",
  exam: "var(--bad)",
  event: "var(--brand)",
  notice: "var(--ink-2)",
};
const KIND_SOFT: Record<NoticeKind, string> = {
  holiday: "var(--good-soft)",
  exam: "var(--bad-soft)",
  event: "var(--brand-soft)",
  notice: "var(--line-2)",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function CalendarPage() {
  const [load, setLoad] = useState<{ state: "loading" } | { state: "error" } | { state: "ok"; events: NoticeView[] }>({
    state: "loading",
  });

  useEffect(() => {
    let alive = true;
    api
      .ntcVisible()
      .then((r) => {
        if (!alive) return;
        const events = r.notices
          .filter((n) => n.eventDate !== null)
          .sort((a, b) => (a.eventDate! < b.eventDate! ? -1 : 1));
        setLoad({ state: "ok", events });
      })
      .catch(() => alive && setLoad({ state: "error" }));
    return () => {
      alive = false;
    };
  }, []);

  // group by "Month Year"
  const groups: { label: string; items: NoticeView[] }[] = [];
  if (load.state === "ok") {
    for (const ev of load.events) {
      const d = new Date(ev.eventDate! + "T00:00:00");
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      const g = groups.find((x) => x.label === label) ?? (groups.push({ label, items: [] }), groups[groups.length - 1]!);
      g.items.push(ev);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Calendar"
        title="Academic calendar"
        lede="Holidays, exams and events across the college — everything on the calendar, scoped to what you may see."
      />

      {load.state === "loading" ? (
        <Skeleton lines={5} />
      ) : load.state === "error" ? (
        <EmptyState title="Couldn't load the calendar." message="Try again shortly." />
      ) : load.events.length === 0 ? (
        <EmptyState title="Nothing on the calendar yet." message="Holidays, exam dates and events will appear here." />
      ) : (
        groups.map((group) => (
          <section key={group.label} className="section" style={{ marginTop: 24 }}>
            <div className="section-head">
              <h2>{group.label}</h2>
              <span className="stat-sub num">{group.items.length} event{group.items.length === 1 ? "" : "s"}</span>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {group.items.map((ev) => {
                const d = new Date(ev.eventDate! + "T00:00:00");
                return (
                  <div key={ev.id} className="card" style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: 14 }}>
                    <div
                      style={{
                        flex: "0 0 auto",
                        width: 52,
                        textAlign: "center",
                        borderRadius: 10,
                        border: `1px solid ${KIND_TONE[ev.kind]}`,
                        background: KIND_SOFT[ev.kind],
                        color: KIND_TONE[ev.kind],
                        padding: "6px 0",
                      }}
                    >
                      <div className="num" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{d.getDate()}</div>
                      <div className="num" style={{ fontSize: 11 }}>{MONTHS[d.getMonth()]}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span
                          className="chip"
                          style={{ textTransform: "capitalize", color: KIND_TONE[ev.kind], borderColor: KIND_TONE[ev.kind], background: KIND_SOFT[ev.kind] }}
                        >
                          {ev.kind}
                        </span>
                        <strong style={{ fontSize: 15 }}>{ev.title}</strong>
                        <span className="stat-sub" style={{ marginLeft: "auto" }}>{ev.audienceLabel}</span>
                      </div>
                      {ev.body ? <p style={{ margin: "6px 0 0", color: "var(--ink-2)", fontSize: 13.5 }}>{ev.body}</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </>
  );
}
