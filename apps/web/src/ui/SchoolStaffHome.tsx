"use client";

import type { AtRiskEntry, Dashboard, Session, TtToday } from "./api";
import { AttendanceSlot, StatTile } from "./charts";
import { focusOf } from "./oversightFocus";
import { Noticeboard } from "./Noticeboard";
import { HelpButton } from "./help/HelpButton";
import { PageHeader } from "@vidya/ui-system";
import styles from "./SchoolStaffHome.module.css";

type WorkspaceRole = "admin" | "principal" | "class_teacher" | "teacher";
type Action = { label: string; detail: string; href: string };

const WORK: Record<WorkspaceRole, Action[]> = {
  admin: [
    { label: "Student records", detail: "Admissions, sections and pupil histories", href: "/manage/students" },
    { label: "Fee counter", detail: "Invoices, payments and receipts", href: "/manage/fees" },
    { label: "Report cards", detail: "Preview, issue and publish", href: "/manage/report-cards" },
    { label: "Teachers", detail: "Staff records and assignments", href: "/manage/teachers" },
  ],
  principal: [
    { label: "School analytics", detail: "Attendance and learning trends", href: "/manage/analytics" },
    { label: "Report cards", detail: "Review issued pupil records", href: "/manage/report-cards" },
    { label: "Leave decisions", detail: "Requests awaiting leadership", href: "/manage/leave" },
    { label: "School notices", detail: "Messages for staff and families", href: "/manage/notices" },
  ],
  class_teacher: [
    { label: "My classes", detail: "Roster and pupil records", href: "/manage/classes" },
    { label: "Attendance", detail: "Mark the whole class register", href: "/manage/attendance" },
    { label: "Report cards", detail: "Check and prepare term records", href: "/manage/report-cards" },
  ],
  teacher: [
    { label: "Attendance", detail: "Mark your teaching periods", href: "/manage/attendance" },
    { label: "Marks", detail: "Assessments and grade entry", href: "/manage/marks" },
    { label: "Coursework", detail: "Assignments and submissions", href: "/manage/coursework" },
    { label: "Syllabus", detail: "Topics and teaching coverage", href: "/manage/syllabus" },
  ],
};

function roleOf(session: Session): WorkspaceRole {
  if (session.roles.includes("admin")) return "admin";
  if (session.roles.includes("principal")) return "principal";
  if (session.roles.includes("class_teacher")) return "class_teacher";
  return "teacher";
}

function headingOf(role: WorkspaceRole): { eyebrow: string; title: string; lede: string } {
  switch (role) {
    case "admin": return { eyebrow: "School office", title: "Your school, in motion.", lede: "Records, people and payments for this academic year." };
    case "principal": return { eyebrow: "School leadership", title: "Decisions for today.", lede: "Learning, attendance and approvals across your school." };
    case "class_teacher": return { eyebrow: "Class teacher", title: "Your class, together.", lede: "Attendance, pupils and term records in one place." };
    case "teacher": return { eyebrow: "Teaching", title: "Your teaching day.", lede: "Open the next task, then return to your class." };
  }
}

export function SchoolStaffHome({ session, dashboard, atRisk, riskStatus, today, todayStatus, leaveWaiting }: {
  session: Session;
  dashboard: Dashboard;
  atRisk: AtRiskEntry[];
  riskStatus: "loading" | "ready" | "partial";
  today: TtToday | null;
  todayStatus: "loading" | "ready" | "unavailable";
  leaveWaiting: number | null;
}) {
  const role = roleOf(session);
  const copy = headingOf(role);
  const focusTile = focusOf(dashboard.tiles)?.tile ?? null;
  const attendance = focusTile && "attendance" in focusTile ? focusTile.attendance : null;
  const studentCount = attendance?.state === "ok" ? attendance.value.distinctStudents : null;
  const classTile = dashboard.tiles.find((tile) => tile.type === "class");
  const classSectionId = classTile?.type === "class" ? classTile.strip[0]?.sectionId : undefined;
  const classSections = dashboard.tiles.flatMap((tile) => tile.type === "class"
    ? tile.strip.map((section) => ({ id: section.sectionId, name: `${dashboard.names[tile.classId] ?? "Class"} · Sec ${section.name}` }))
    : []);
  const firstPeriod = today?.entries[0];

  const priority: { kicker: string; title: string; detail: string; action: string; href: string } = role === "admin"
    ? { kicker: "School office", title: "Keep the register moving.", detail: "Start with a pupil record, then follow through on fees, staff and reports.", action: "Open student records", href: "/manage/students" }
    : role === "principal"
      ? leaveWaiting !== null && leaveWaiting > 0
        ? { kicker: "Waiting on you", title: `${leaveWaiting} leave request${leaveWaiting === 1 ? "" : "s"} to decide.`, detail: "Review each request with its school context before deciding.", action: "Review leave", href: "/manage/leave" }
        : { kicker: "School overview", title: "See where support is needed.", detail: "Open the current attendance and learning picture, then follow the pupils behind each figure.", action: "Open analytics", href: "/manage/analytics" }
      : role === "class_teacher"
        ? { kicker: "Class register", title: "Start with your class.", detail: "Record attendance, then check the pupils and term records in your care.", action: "Open class attendance", href: classSectionId ? `/manage/attendance?sectionId=${encodeURIComponent(classSectionId)}` : "/manage/attendance" }
        : firstPeriod
          ? { kicker: "Teaching timetable", title: firstPeriod.subjectName, detail: `${firstPeriod.className} · Sec ${firstPeriod.sectionName} · Period ${firstPeriod.periodNo}`, action: "Open attendance", href: `/manage/attendance?sectionId=${encodeURIComponent(firstPeriod.sectionId)}&subjectId=${encodeURIComponent(firstPeriod.subjectId)}&slot=${encodeURIComponent(`p${firstPeriod.periodNo}`)}` }
          : { kicker: "Teaching work", title: todayStatus === "loading" ? "Your timetable is loading." : todayStatus === "unavailable" ? "Timetable unavailable." : "No periods scheduled today.", detail: "Your assessments and coursework are ready whenever you are.", action: "Open marks", href: "/manage/marks" };

  return (
    <div className={styles.workspace}>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} lede={copy.lede} help={<HelpButton slug="dashboard" />} />
      <div className={styles.opening}>
        <section className={styles.priority} aria-label="Priority work">
          <span className={styles.kicker}>{priority.kicker}</span>
          <h2>{priority.title}</h2>
          <p>{priority.detail}</p>
          <a className={styles.primaryAction} href={priority.href}>{priority.action}<span aria-hidden="true">→</span></a>
        </section>
        <section className={styles.workspaces} aria-label="Your workspaces">
          <div className={styles.sectionTitle}><h2>Your workspaces</h2><span>{dashboard.academicYear}</span></div>
          <div className={styles.actionList}>
            {WORK[role].map((item, index) => (
              <a key={item.href} className={styles.action} href={item.href}>
                <span className={styles.actionNumber}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.actionText}><strong>{item.label}</strong><small>{item.detail}</small></span>
                <span className={styles.actionArrow} aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.figures} aria-label="School figures">
        <div className={styles.sectionTitle}><h2>{role === "principal" || role === "admin" ? "School pulse" : "Your pupils"}</h2><span>{dashboard.academicYear}</span></div>
        <div className={styles.metricGrid}>
          {attendance ? <AttendanceSlot slot={attendance} /> : <StatTile value="Not recorded" label="Attendance" muted />}
          <a className={styles.metricLink} href={role === "teacher" ? "/manage/marks" : "/manage/report-cards"}>
            <strong>View <span aria-hidden="true">↗</span></strong>
            <span>{role === "teacher" ? "Term marks" : "Term records"}</span>
          </a>
          <StatTile value={riskStatus === "ready" ? String(atRisk.length) : "Unavailable"} label="Pupils to review" muted={riskStatus !== "ready"} />
          <StatTile value={studentCount === null ? "Not recorded" : String(studentCount)} label="Pupils with attendance" muted={studentCount === null} />
        </div>
      </section>

      <div className={styles.lower}>
        {role === "class_teacher" && (
          <section className={styles.panel} aria-label="Your class register">
            <div className={styles.sectionTitle}><h2>Your class register</h2><a href="/manage/classes">Open roster</a></div>
            {classSections.length === 0 ? <p className={styles.empty}>No class assignment is available yet.</p> : (
              <ul className={styles.classList}>{classSections.map((section) => <li key={section.id}>
                <strong>{section.name}</strong>
                <a href={`/manage/attendance?sectionId=${encodeURIComponent(section.id)}`}>Take attendance</a>
              </li>)}</ul>
            )}
          </section>
        )}
        {role === "teacher" && (
          <section className={styles.panel} aria-label="Today's teaching">
            <div className={styles.sectionTitle}><h2>Today’s teaching</h2><a href="/manage/my-timetable">Full timetable</a></div>
            {todayStatus === "unavailable" ? <p className={styles.empty}>Today’s timetable is unavailable. Open the full timetable to retry.</p> : today === null ? <p className={styles.empty}>Loading today’s periods…</p> : today.entries.length === 0 ? <p className={styles.empty}>No periods scheduled today.</p> : (
              <ol className={styles.periods}>{today.entries.map((entry) => {
                const time = today.periods.find((period) => period.periodNo === entry.periodNo);
                return <li key={entry.id}>
                  <span className={styles.periodTime}>P{entry.periodNo}{time ? <small>{time.starts}–{time.ends}</small> : null}</span>
                  <span className={styles.periodSubject}><strong>{entry.subjectName}</strong><small>{entry.className} · Sec {entry.sectionName}</small></span>
                  <a href={`/manage/attendance?sectionId=${encodeURIComponent(entry.sectionId)}&subjectId=${encodeURIComponent(entry.subjectId)}&slot=${encodeURIComponent(`p${entry.periodNo}`)}`}>Attendance</a>
                </li>;
              })}</ol>
            )}
          </section>
        )}
        <section className={styles.panel} aria-label="Pupils needing attention">
          <div className={styles.sectionTitle}><h2>Pupils to review</h2><span>{riskStatus === "ready" ? atRisk.length : riskStatus === "loading" ? "Loading" : "Data unavailable"}</span></div>
          {riskStatus === "loading" ? <p className={styles.empty}>Loading pupils to review…</p> : riskStatus === "partial" ? <p className={styles.empty}>This list could not be fully loaded. Open analytics to retry.</p> : atRisk.length === 0 ? <p className={styles.empty}>No pupils are flagged by the current analytics.</p> : (
            <ul className={styles.riskList}>{atRisk.slice(0, 6).map((entry) => <li key={entry.studentId}>
              <a href={`/students/${encodeURIComponent(entry.studentId)}`}>{entry.name}</a>
              <span>{entry.reasons.map((reason) => reason === "low-attendance" ? "Attendance" : "Marks").join(" · ")}</span>
            </li>)}</ul>
          )}
        </section>
      </div>
      <section className={styles.notices} aria-label="School noticeboard"><Noticeboard /></section>
    </div>
  );
}
