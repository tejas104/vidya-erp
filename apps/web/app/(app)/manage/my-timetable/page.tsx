"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, currentAcademicYear, type TtWeek } from "@/ui/api";
import { EmptyState, PageHeader, Table, type TableColumn } from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
type DayKey = (typeof DAY_KEYS)[number];
type Row = { period: ReactNode } & Record<DayKey, ReactNode>;

export default function MyTimetablePage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [week, setWeek] = useState<TtWeek | null>(null);
  const [unlinked, setUnlinked] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setWeek(null);
    setUnlinked(false);
    setError(false);
    try {
      setWeek(await api.ttMyWeek(year));
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
      <EmptyState title="This sign-in isn't linked to a teacher record." body="Ask the office to link your account." />
    );
  }

  const columns: TableColumn<Row>[] = [
    { key: "period", header: "Period" },
    { key: "mon", header: "Mon" },
    { key: "tue", header: "Tue" },
    { key: "wed", header: "Wed" },
    { key: "thu", header: "Thu" },
    { key: "fri", header: "Fri" },
    { key: "sat", header: "Sat" },
  ];
  const rows: Row[] = (week?.periods ?? []).map((period) => {
    const row = {
      period: (
        <>
          <strong>P{period.periodNo}</strong> <span className={`num ${styles.periodTime}`}>{period.starts}–{period.ends}</span>
        </>
      ),
    } as Row;
    DAY_KEYS.forEach((key, index) => {
      const day = index + 1;
      const entry = week?.entries.find((e) => e.dayOfWeek === day && e.periodNo === period.periodNo);
      row[key] = entry ? (
        <>
          <strong>{entry.subjectName}</strong>
          <br />
          <span className={styles.entryMeta}>
            {entry.className} · Sec {entry.sectionName}
            {entry.room !== "" ? ` · ${entry.room}` : ""}
          </span>
        </>
      ) : (
        <span className={styles.blank}>—</span>
      );
    });
    return row;
  });

  return (
    <>
      <PageHeader eyebrow="Timetable" title="My timetable" />
      <p className={styles.lede}>Your own weekly schedule, across every day you teach.</p>
      <AsyncState
        loading={week === null && !error}
        error={error}
        onRetry={() => void load()}
        isEmpty={week !== null && (week.periods.length === 0 || week.entries.length === 0)}
        empty={<EmptyState title="No periods scheduled." body="Nothing is on your timetable yet." />}
      >
        <Table columns={columns} rows={rows} />
      </AsyncState>
    </>
  );
}
