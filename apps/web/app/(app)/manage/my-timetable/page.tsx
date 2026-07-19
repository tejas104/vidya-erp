"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, currentAcademicYear, type TtWeek } from "@/ui/api";
import { PageHeader } from "@/ui/PageHeader";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Load = { state: "loading" } | { state: "unlinked" } | { state: "error" } | { state: "ok"; week: TtWeek };

export default function MyTimetablePage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const week = await api.ttMyWeek(year);
        if (alive) setLoad({ state: "ok", week });
      } catch (caught) {
        if (!alive) return;
        if (caught instanceof ApiError && caught.status === 404) setLoad({ state: "unlinked" });
        else setLoad({ state: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [year]);

  if (load.state === "loading") return <Skeleton lines={5} />;
  if (load.state === "unlinked") {
    return <EmptyState title="This sign-in isn't linked to a teacher record." message="Ask the office to link your account." />;
  }
  if (load.state === "error") return <EmptyState title="Couldn't load your timetable." message="Try again shortly." />;

  const { week } = load;
  const cell = (day: number, periodNo: number) =>
    week.entries.find((entry) => entry.dayOfWeek === day && entry.periodNo === periodNo);

  return (
    <>
      <PageHeader eyebrow="Timetable" title="My timetable" lede="Your own weekly schedule, across every day you teach." />
      {week.periods.length === 0 || week.entries.length === 0 ? (
        <EmptyState title="No periods scheduled." message="Nothing is on your timetable yet." />
      ) : (
        <div className="ui-tablewrap">
          <table className="ui-table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th scope="col">Period</th>
                {DAYS.map((day) => (
                  <th key={day} scope="col">{day}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {week.periods.map((period) => (
                <tr key={period.periodNo}>
                  <td>
                    <strong>P{period.periodNo}</strong>{" "}
                    <span className="num" style={{ opacity: 0.6, fontSize: 12 }}>
                      {period.starts}–{period.ends}
                    </span>
                  </td>
                  {DAYS.map((_, index) => {
                    const day = index + 1;
                    const entry = cell(day, period.periodNo);
                    return (
                      <td key={day} style={{ fontSize: 12.5 }}>
                        {entry ? (
                          <>
                            <strong>{entry.subjectName}</strong>
                            <br />
                            <span style={{ opacity: 0.7 }}>
                              {entry.className} · Sec {entry.sectionName}
                              {entry.room !== "" ? ` · ${entry.room}` : ""}
                            </span>
                          </>
                        ) : (
                          <span style={{ opacity: 0.3 }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
