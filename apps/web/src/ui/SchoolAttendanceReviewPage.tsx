"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, PageHeader, Select, StatusBadge } from "@vidya/ui-system";
import { api, ApiError, currentAcademicYear, type OrgTree, type SchoolAttendanceShortfall } from "./api";
import { HelpButton } from "./help/HelpButton";
import styles from "./SchoolAttendanceReviewPage.module.css";

type SectionOption = { id: string; label: string; collegeId: string };
type TermOption = { id: string; name: string; academicYear: string; collegeId: string; startsOn: string; endsOn: string };
function schoolToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const read = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function SchoolAttendanceReviewPage() {
  const router = useRouter();
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [termId, setTermId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [through, setThrough] = useState(schoolToday);
  const [report, setReport] = useState<SchoolAttendanceShortfall | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canMark, setCanMark] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.allSettled([api.schoolTerms(), api.schoolReportCardDeskScope(), api.colleges(), api.dashboard(currentAcademicYear()), api.session()]).then(async ([termResult, deskResult, collegesResult, dashboardResult, sessionResult]) => {
      const colleges = collegesResult.status === "fulfilled" ? collegesResult.value.colleges : [];
      const trees = await Promise.allSettled(colleges.map((college) => api.collegeTree(college.id)));
      if (!active) return;
      const choices = trees.flatMap((result) => result.status === "fulfilled" ? sectionsFromTree(result.value) : []);
      const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
      const deskScope = deskResult.status === "fulfilled" ? deskResult.value : null;
      if (dashboard) for (const tile of dashboard.tiles) {
        if (tile.type !== "class") continue;
        for (const item of tile.strip) choices.push({ id: item.sectionId, label: `${dashboard.names[tile.classId] ?? "Class"} · ${item.name}`, collegeId: deskScope?.classes.find((schoolClass) => schoolClass.id === tile.classId)?.collegeId ?? "" });
      }
      const unique = [...new Map(choices.map((item) => [item.id, item])).values()];
      const listed = termResult.status === "fulfilled" ? termResult.value.terms : [];
      const deskTerms = deskScope?.terms ?? [];
      const visibleTerms: TermOption[] = listed.length ? listed : deskTerms;
      if (!visibleTerms.length && !unique.length) throw new Error("No authorized attendance scope");
      setTerms(visibleTerms);
      setSections(unique);
      setCanMark(sessionResult.status === "fulfilled" && sessionResult.value.roles.includes("class_teacher"));
      const today = schoolToday();
      const activeTerm = visibleTerms.find((item) => item.startsOn <= today && today <= item.endsOn);
      setTermId((value) => value || activeTerm?.id || visibleTerms[0]?.id || "");
    }).catch((caught: unknown) => { if (active) setError(caught instanceof ApiError && caught.status === 403 ? "You do not have access to this review." : "Could not load school sections and terms."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const term = terms.find((item) => item.id === termId);
  const eligibleSections = useMemo(() => sections.filter((section) => !term || !section.collegeId || section.collegeId === term.collegeId), [sections, term]);
  useEffect(() => { if (!eligibleSections.some((section) => section.id === sectionId)) setSectionId(eligibleSections[0]?.id ?? ""); }, [eligibleSections, sectionId]);
  async function review() {
    if (!termId || !sectionId) return;
    setReviewing(true); setError(null); setReport(null);
    try { setReport(await api.schoolAttendanceShortfall(sectionId, termId, through)); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not load attendance review."); }
    finally { setReviewing(false); }
  }
  const confirmed = report?.students.filter((student) => student.shortfall === true).length ?? 0;
  const incomplete = report?.students.filter((student) => student.shortfall === null).length ?? 0;
  return <>
    <PageHeader eyebrow="School attendance" title="Attendance review" lede="See missing daily registers first, then identify pupils whose recorded attendance is below the school's threshold." help={<HelpButton slug="attendance-review" />} />
    <button type="button" className={styles.back} onClick={() => router.back()}>← Back to previous page</button>
    <Card title="Choose a register">
      <div className={styles.filters}>
        <Select label="Term" value={termId} onChange={(event) => { const selected = terms.find((item) => item.id === event.target.value); setTermId(event.target.value); setThrough(selected && selected.endsOn < schoolToday() ? selected.endsOn : schoolToday()); setReport(null); }} options={terms.map((item) => ({ value: item.id, label: `${item.name} · ${item.academicYear}` }))} />
        <Select label="Section" value={sectionId} onChange={(event) => { setSectionId(event.target.value); setReport(null); }} options={eligibleSections.map((item) => ({ value: item.id, label: item.label }))} />
        <label className={styles.dateLabel}>Through date<input type="date" value={through} min={term?.startsOn} max={term && term.endsOn < schoolToday() ? term.endsOn : schoolToday()} onChange={(event) => { setThrough(event.target.value); setReport(null); }} /></label>
        <Button onClick={() => void review()} loading={reviewing} disabled={loading || !termId || !sectionId || (term ? term.startsOn > schoolToday() : false)}>Review attendance</Button>
      </div>
      {loading ? <p role="status">Loading school sections…</p> : null}
      {!loading && (terms.length === 0 || eligibleSections.length === 0) ? <EmptyState title="No term or section available" body="Set up an academic term and a section before reviewing attendance." /> : null}
      {error ? <p className={styles.error} role="alert">{error} {error.includes("instructional") ? <Link href="/manage/terms">Set school days →</Link> : null}</p> : null}
    </Card>
    {report ? <>
      <div className={styles.metrics}>
        <div><span>Scheduled days</span><strong>{report.scheduledDates.length}</strong></div>
        <div><span>Registers missing</span><strong>{report.unsubmittedDates.length}</strong></div>
        <div><span>Need data</span><strong>{incomplete}</strong></div>
        <div><span>Confirmed below {report.threshold}%</span><strong>{confirmed}</strong></div>
      </div>
      {report.unsubmittedDates.length ? <Card title="Daily registers to complete"><p className={styles.hint}>A missing register is not a pupil absence. Percentages stay unavailable until every scheduled day has a pupil entry.</p><div className={styles.dates}>{report.unsubmittedDates.map((date) => <span key={date}>{date}</span>)}</div>{canMark ? <Link href={`/manage/attendance?sectionId=${encodeURIComponent(sectionId)}&date=${report.unsubmittedDates[0]}`} className={styles.actionLink}>Open this register →</Link> : <p className={styles.hint}>Ask the class teacher to complete these dates.</p>}</Card> : null}
      <Card title="Pupil review"><p className={styles.hint}>Attendance counts use the class teacher's daily register. Subject period attendance is separate. {report.rosterAssumption}</p>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th scope="col">Pupil</th><th scope="col">Recorded / expected</th><th scope="col">Absent</th><th scope="col">Missing pupil entries</th><th scope="col">Attendance</th><th scope="col">Review</th></tr></thead><tbody>{report.students.map((student) => <tr key={student.studentId}><td><strong>{student.fullName}</strong><small>{student.admissionNo}</small></td><td>{student.recordedDays} / {student.expectedDays}</td><td>{student.absentDays}</td><td>{student.missingEntryDates.length ? student.missingEntryDates.join(", ") : "—"}</td><td>{student.percentage === null ? "Awaiting complete data" : `${student.percentage.toFixed(2)}%`}</td><td>{student.shortfall === null ? <StatusBadge status="neutral">Needs data</StatusBadge> : student.shortfall ? <StatusBadge status="warn">Below threshold</StatusBadge> : <StatusBadge status="good">On track</StatusBadge>}</td></tr>)}</tbody></table></div>
        {report.students.length === 0 ? <EmptyState title="No pupils in this section" body="The current roster has no pupils for this academic year." /> : null}
      </Card>
    </> : null}
  </>;
}

function sectionsFromTree(tree: OrgTree): SectionOption[] {
  return tree.departments.flatMap((department) => department.classes.flatMap((schoolClass) => schoolClass.sections.map((section) => ({ id: section.id, label: `${schoolClass.name} · ${section.name}`, collegeId: tree.college.id }))));
}
