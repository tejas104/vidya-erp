"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, currentAcademicYear, type TtToday } from "@/ui/api";
import { EmptyState, PageHeader, StatusBadge } from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import { deriveNow, type NowEntry, type NowSlot, type NowState } from "@/ui/nowPeriod";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

// Hands off to the same attendance screen every other entry point uses
// (My Classes, the dashboard command card) — sectionId/subjectId/slot/date
// are the params it already reads (see manage/attendance/page.tsx).
function attendanceHref(entry: NowEntry, dateIso: string): string {
  return (
    `/manage/attendance?sectionId=${encodeURIComponent(entry.sectionId)}` +
    `&subjectId=${encodeURIComponent(entry.subjectId)}` +
    `&slot=${encodeURIComponent(`p${entry.periodNo}`)}` +
    `&date=${encodeURIComponent(dateIso)}`
  );
}

function timeRange(slot: NowSlot): string {
  return slot.period ? `${slot.period.starts}–${slot.period.ends}` : "—";
}

function whereOf(entry: NowEntry): string {
  return `${entry.className} · Sec ${entry.sectionName}${entry.room !== "" ? ` · ${entry.room}` : ""}`;
}

function NowBody({ state, nowMinutes, todayIso }: { state: NowState; nowMinutes: number; todayIso: string }) {
  if (state.kind === "no-timetable") {
    return (
      <EmptyState
        title="No timetable set up yet."
        body="Once your college's timetable is published, today's periods will appear here."
      />
    );
  }
  if (state.kind === "off-day") {
    return <EmptyState title="No classes today." body="It's a non-teaching day." />;
  }
  if (state.kind === "no-classes") {
    return (
      <EmptyState title="Nothing on your timetable today." body="Check My Timetable for your full week." />
    );
  }
  if (state.kind === "day-done") {
    return (
      <EmptyState title="Your teaching day is done." body="Nothing left to teach today — nice work." />
    );
  }

  const { featured, ongoing, remaining } = state;
  const startsIn = featured.startMin !== null ? featured.startMin - nowMinutes : null;

  return (
    <>
      <div className={styles.hero}>
        <StatusBadge status={ongoing ? "good" : "neutral"}>
          {ongoing ? "In session now" : startsIn !== null ? `Up next · starts in ${startsIn} min` : "Up next"}
        </StatusBadge>
        <h2 className={styles.subject}>{featured.entry.subjectName}</h2>
        <p className={styles.where}>{whereOf(featured.entry)}</p>
        <p className={styles.time}>{timeRange(featured)}</p>
        <a className={styles.primary} href={attendanceHref(featured.entry, todayIso)}>
          Mark attendance
        </a>
      </div>

      {remaining.length > 0 ? (
        <section className={styles.rest} aria-label="Today's remaining periods">
          <h3 className={styles.restHead}>Later today</h3>
          <div className={styles.restList}>
            {remaining.map((slot) => (
              <div key={slot.entry.id} className={styles.restRow}>
                <span className={styles.restTime}>{timeRange(slot)}</span>
                <span className={styles.restSubject}>{slot.entry.subjectName}</span>
                <span className={styles.restWhere}>{whereOf(slot.entry)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export default function NowPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [today, setToday] = useState<TtToday | null>(null);
  const [unlinked, setUnlinked] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setToday(null);
    setUnlinked(false);
    setError(false);
    try {
      setToday(await api.ttMyToday(year));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) setUnlinked(true);
      else setError(true);
    }
  }, [year]);
  useEffect(() => {
    void load();
  }, [load]);

  if (unlinked) {
    return (
      <EmptyState
        title="This sign-in isn't linked to a teacher record."
        body="Ask the office to link your account — then your day appears here."
      />
    );
  }

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const state = today !== null ? deriveNow(today, nowMinutes) : null;

  return (
    <>
      <PageHeader eyebrow="Now" title="Right now" />
      <AsyncState
        loading={today === null && !error}
        error={error}
        errorMessage="Couldn't load your timetable. Try again shortly."
        onRetry={() => void load()}
      >
        {state !== null ? <NowBody state={state} nowMinutes={nowMinutes} todayIso={todayIso} /> : null}
      </AsyncState>
    </>
  );
}
