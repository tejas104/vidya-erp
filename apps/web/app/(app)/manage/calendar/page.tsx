"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type NoticeView } from "@/ui/api";
import { AsyncState } from "@/ui/AsyncState";
import { EmptyState, PageHeader } from "@vidya/ui-system";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function CalendarPage() {
  const [fetchState, setFetchState] = useState<
    { state: "loading" } | { state: "error" } | { state: "ok"; events: NoticeView[] }
  >({ state: "loading" });

  const load = useCallback(async () => {
    setFetchState({ state: "loading" });
    try {
      const r = await api.ntcVisible();
      const events = r.notices
        .filter((n) => n.eventDate !== null)
        .sort((a, b) => (a.eventDate! < b.eventDate! ? -1 : 1));
      setFetchState({ state: "ok", events });
    } catch {
      setFetchState({ state: "error" });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // group by "Month Year"
  const groups: { label: string; items: NoticeView[] }[] = [];
  if (fetchState.state === "ok") {
    for (const ev of fetchState.events) {
      const d = new Date(ev.eventDate! + "T00:00:00");
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      const g = groups.find((x) => x.label === label) ?? (groups.push({ label, items: [] }), groups[groups.length - 1]!);
      g.items.push(ev);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Calendar" title="Academic calendar" />
      <p className={styles.lede}>
        Holidays, exams and events across the college — everything on the calendar, scoped to what you may see.
      </p>

      <AsyncState
        loading={fetchState.state === "loading"}
        error={fetchState.state === "error"}
        errorMessage="Couldn't load the calendar. Try again shortly."
        onRetry={() => void load()}
        isEmpty={fetchState.state === "ok" && fetchState.events.length === 0}
        empty={<EmptyState title="Nothing on the calendar yet." body="Holidays, exam dates and events will appear here." />}
      >
        {groups.map((group) => (
          <section key={group.label} className={`section ${styles.monthSection}`}>
            <div className="section-head">
              <h2>{group.label}</h2>
              <span className="stat-sub num">{group.items.length} event{group.items.length === 1 ? "" : "s"}</span>
            </div>
            <div className={styles.eventList}>
              {group.items.map((ev) => {
                const d = new Date(ev.eventDate! + "T00:00:00");
                return (
                  <div key={ev.id} className={`card ${styles.eventCard}`}>
                    <div className={styles.dateBadge} data-kind={ev.kind}>
                      <div className={`num ${styles.dateNum}`}>{d.getDate()}</div>
                      <div className={`num ${styles.dateMonth}`}>{MONTHS[d.getMonth()]}</div>
                    </div>
                    <div className={styles.eventBody}>
                      <div className={styles.eventHead}>
                        <span className={styles.kindChip} data-kind={ev.kind}>{ev.kind}</span>
                        <strong className={styles.eventTitle}>{ev.title}</strong>
                        <span className={`stat-sub ${styles.audience}`}>{ev.audienceLabel}</span>
                      </div>
                      {ev.body ? <p className={styles.eventText}>{ev.body}</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </AsyncState>
    </>
  );
}
