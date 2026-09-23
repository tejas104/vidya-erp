"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, Input, PageHeader, StatusBadge, Tabs } from "@vidya/ui-system";
import {
  api,
  ApiError,
  currentAcademicYear,
  type GuardianChild,
  type PortalAttendance,
  type PortalMarks,
  type TtEntry,
  type TtPeriod,
} from "@/ui/api";
import { AsyncState } from "@/ui/AsyncState";
import { StatTile, SubjectBars } from "@/ui/charts";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/**
 * The family portal (ADR-0027). A guardian sees each linked child's records
 * only in the categories their relationship covers; the server decides every
 * one of those per request, and this page merely skips what it was not given.
 */

type Children = { state: "loading" } | { state: "error" } | { state: "ok"; children: GuardianChild[] };

type ChildRecords = {
  attendance: PortalAttendance | null;
  marks: PortalMarks | null;
  today: { dayOfWeek: number; periods: TtPeriod[]; entries: TtEntry[] } | null;
};

/** A category the server withholds answers 403: show nothing, not an error. */
async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 403) return null;
    throw caught;
  }
}

export default function FamilyPage() {
  const year = useMemo(() => currentAcademicYear(), []);
  const [list, setList] = useState<Children>({ state: "loading" });
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .guardianChildren()
      .then(({ children }) => {
        setList({ state: "ok", children });
        setSelected((current) => current ?? children[0]?.studentId ?? null);
      })
      .catch(() => setList({ state: "error" }));
  }, []);

  useEffect(load, [load]);

  if (list.state !== "ok") {
    return <AsyncState loading={list.state === "loading"} error={list.state === "error"} onRetry={load}>{null}</AsyncState>;
  }

  const child = list.children.find((candidate) => candidate.studentId === selected) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Family"
        title={child?.fullName ?? "Your children"}
        lede={child !== null ? `Admission no. ${child.admissionNo} · ${year}` : undefined}
      />

      {list.children.length > 1 ? (
        <div className={styles.switcher}>
          <Tabs
            tabs={list.children.map((candidate) => ({ id: candidate.studentId, label: candidate.fullName }))}
            active={selected ?? ""}
            onChange={setSelected}
          />
        </div>
      ) : null}

      {child === null ? (
        <EmptyState
          title="No children linked yet."
          body="When the school gives you an invitation code for your child, enter it below."
        />
      ) : child.status === "pending" ? (
        <EmptyState
          title="Waiting for the school to confirm you."
          body="Your link to this child needs to be verified by the school office before their records appear. You don't need to do anything else."
        />
      ) : child.status !== "active" && child.status !== "restricted" ? (
        <EmptyState title="This link is no longer active." body="Contact the school office if you think this is a mistake." />
      ) : (
        <ChildView key={child.studentId} child={child} year={year} />
      )}

      <LinkAnotherChild onLinked={load} />
    </>
  );
}

function ChildView({ child, year }: { child: GuardianChild; year: string }) {
  const [records, setRecords] = useState<{ state: "loading" } | { state: "error" } | { state: "ok"; data: ChildRecords }>({ state: "loading" });
  const can = (category: string) => child.categories.includes(category);

  const load = useCallback(() => {
    setRecords({ state: "loading" });
    Promise.all([
      can("attendance") ? orNull(api.childAttendance(child.studentId, year)) : Promise.resolve(null),
      can("marks") ? orNull(api.childMarks(child.studentId, year)) : Promise.resolve(null),
      can("timetable") ? orNull(api.childToday(child.studentId, year)) : Promise.resolve(null),
    ])
      .then(([attendance, marks, today]) => setRecords({ state: "ok", data: { attendance, marks, today } }))
      .catch(() => setRecords({ state: "error" }));
  }, [child, year]);

  useEffect(load, [load]);

  if (records.state !== "ok") {
    return <AsyncState loading={records.state === "loading"} error={records.state === "error"} onRetry={load}>{null}</AsyncState>;
  }
  const { attendance, marks, today } = records.data;
  const sessions = attendance === null ? 0 : Object.values(attendance.counts).reduce((sum, n) => sum + n, 0);

  return (
    <>
      <section className="stats" aria-label="At a glance">
        {attendance !== null ? (
          <StatTile
            value={attendance.pct === null ? "Not recorded" : `${attendance.pct}%`}
            label="Attendance this year"
            sub={sessions === 0 ? "No register taken yet" : `${sessions} sessions`}
            muted={attendance.pct === null}
          />
        ) : null}
        {/* "0 days absent" before any register is taken would be an invented figure. */}
        {attendance !== null && sessions > 0 ? <StatTile value={String(attendance.counts.absent)} label="Days absent" /> : null}
        {marks !== null ? (
          <StatTile
            value={marks.overallPct === null ? "Not recorded" : `${marks.overallPct}%`}
            label="Overall marks this year"
            muted={marks.overallPct === null}
          />
        ) : null}
      </section>

      {today !== null ? (
        <section className="section" aria-label="Today">
          <div className="section-head"><h2>Today</h2></div>
          {today.entries.length === 0 ? (
            <EmptyState title="No classes today." />
          ) : (
            <Card>
              <ul className={styles.periods}>
                {today.entries.map((entry) => {
                  const period = today.periods.find((candidate) => candidate.periodNo === entry.periodNo);
                  return (
                    <li key={entry.id} className={styles.period}>
                      <span className="num">
                        P{entry.periodNo}
                        {period !== undefined ? ` · ${period.starts}–${period.ends}` : ""}
                      </span>
                      <strong>{entry.subjectName}</strong>
                      <span className={styles.muted}>{entry.teacherName}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>
      ) : null}

      {marks !== null ? (
        <section className="section" aria-label="Marks by subject">
          <div className="section-head"><h2>Marks</h2></div>
          {marks.subjects.length === 0 ? (
            <EmptyState title="No marks recorded yet." body="Scores appear here as teachers enter them." />
          ) : (
            <Card>
              <SubjectBars rows={marks.subjects.map((subject, index) => ({ label: subject.name, value: subject.avgPct, index }))} />
            </Card>
          )}
        </section>
      ) : null}

      {attendance !== null && attendance.sessions.length > 0 ? (
        <section className="section" aria-label="Recent attendance">
          <div className="section-head"><h2>Recent attendance</h2></div>
          <Card>
            <ul className={styles.periods}>
              {attendance.sessions.slice(0, 10).map((row) => (
                <li key={row.heldOn} className={styles.period}>
                  <span className="num">{row.heldOn}</span>
                  <StatusBadge status={row.status === "absent" ? "danger" : row.status === "late" ? "warn" : "good"}>{row.status}</StatusBadge>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}

function LinkAnotherChild({ onLinked }: { onLinked: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const linked = await api.guardianRedeem(code.trim());
      setCode("");
      setMessage({
        kind: "ok",
        text: linked.status === "active" ? `${linked.child.fullName} is now linked.` : `${linked.child.fullName} is linked, waiting for the school to confirm you.`,
      });
      onLinked();
    } catch {
      setMessage({ kind: "error", text: "That code can't be used. Ask the school for a new one." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-label="Link another child">
      <Card title="Link another child">
        <form className={styles.linkForm} onSubmit={submit}>
          <Input label="Invitation code" hint="From the school, e.g. ABCDE-FGHJK-MNPQR-STVWX" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" required />
          <Button type="submit" loading={busy} disabled={code.trim().length < 20}>
            Link child
          </Button>
        </form>
        {message !== null ? (
          <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? styles.error : styles.ok}>
            {message.text}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
