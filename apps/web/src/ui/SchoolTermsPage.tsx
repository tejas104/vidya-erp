"use client";
import { useEffect, useState } from "react";
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, StatusBadge, Table, useToast } from "@vidya/ui-system";
import { api, ApiError, currentAcademicYear, type SchoolTermView } from "./api";
import { AsyncState } from "./AsyncState";
import { AssessmentTypesEditor } from "./AssessmentTypesEditor";
import { schoolVocabulary } from "./editionVocabulary";
import { HelpButton } from "./help/HelpButton";
import styles from "./SchoolTermsPage.module.css";

export function SchoolTermsPage() {
  const toast = useToast();
  const [terms, setTerms] = useState<SchoolTermView[]>([]);
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [revision, setRevision] = useState(0);
  const [year, setYear] = useState(currentAcademicYear);
  const [filterYear, setFilterYear] = useState(currentAcademicYear);
  const [creating, setCreating] = useState(false);
  const [collegeId, setCollegeId] = useState("");
  const [name, setName] = useState("");
  const [academicYear, setAcademicYear] = useState(currentAcademicYear);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [target, setTarget] = useState<SchoolTermView | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<SchoolTermView | null>(null);
  const [configuring, setConfiguring] = useState<SchoolTermView | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setDenied(false);
    Promise.all([api.schoolTerms(filterYear), api.session(), api.colleges()]).then(([result, session, institutions]) => {
      if (!alive) return;
      setTerms(result.terms);
      setAdmin(session.roles.includes("admin"));
      setSchools(institutions.colleges);
      setCollegeId((previous) => previous || institutions.colleges[0]?.id || "");
    }).catch((caught: unknown) => {
      if (!alive) return;
      const forbidden = caught instanceof ApiError && caught.status === 403;
      setDenied(forbidden);
      setError(forbidden ? "You don't have access to academic terms." : "Couldn't load academic terms. Check your connection and retry.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filterYear, revision]);

  function closeDialog() {
    if (saving) return;
    setCreating(false);
    setTarget(null);
    setReleaseTarget(null);
    setSaveError(null);
  }

  async function create() {
    if (saving || !collegeId || !name.trim() || !academicYear.trim() || !startsOn || !endsOn || endsOn < startsOn) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.schoolCreateTerm({ collegeId, name: name.trim(), academicYear: academicYear.trim(), startsOn, endsOn });
      setCreating(false);
      setName("");
      setStartsOn("");
      setEndsOn("");
      setYear(academicYear.trim());
      setFilterYear(academicYear.trim());
      setRevision((value) => value + 1);
      toast.push({ status: "good", message: "Academic term created." });
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : "Couldn't create the term. Please retry.");
    } finally { setSaving(false); }
  }

  async function transition() {
    if (!target || saving || (target.status === "closed" && !reason.trim())) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.schoolTransitionTerm(target.id, target.status === "open" ? "close" : "reopen", reason);
      setTerms((current) => current.map((term) => term.id === updated.id ? updated : term));
      setTarget(null);
      toast.push({ status: "good", message: updated.status === "open" ? "Term reopened. The reason has been recorded." : "Term closed." });
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : "Couldn't update the term. Please retry.");
    } finally { setSaving(false); }
  }

  async function releaseMarks() {
    if (!releaseTarget || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.schoolReleaseTermMarks(releaseTarget.id);
      setTerms((current) => current.map((term) => term.id === updated.id ? updated : term));
      setReleaseTarget(null);
      toast.push({ status: "good", message: "Term marks released to students and eligible families." });
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : "Couldn't release term marks. Please retry.");
    } finally { setSaving(false); }
  }

  return <>
    <PageHeader eyebrow="Academics" title={schoolVocabulary.academicTerms} lede={`Manage the school calendar for each ${schoolVocabulary.academicYear.toLowerCase()} and keep a record of term closures and reopening reasons.`} help={<HelpButton slug="terms" />} />
    <div className={styles.toolbar}>
      <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); setFilterYear(year.trim()); setRevision((value) => value + 1); }}>
        <Input label={schoolVocabulary.academicYear} value={year} maxLength={32} onChange={(event) => setYear(event.target.value)} placeholder="All years" />
        <Button type="submit" variant="secondary" disabled={loading}>Apply</Button>
      </form>
      {admin && !error ? <Button disabled={loading || schools.length === 0} onClick={() => { setAcademicYear(filterYear || currentAcademicYear()); setSaveError(null); setCreating(true); }}>Create term</Button> : null}
    </div>
    <AsyncState loading={loading} error={error !== null} errorMessage={error} onRetry={denied ? undefined : () => setRevision((value) => value + 1)}
      isEmpty={terms.length === 0} empty={<EmptyState title={`No terms for this ${schoolVocabulary.academicYear.toLowerCase()}`} body={admin ? `Create a term with its dates to begin setting up this ${schoolVocabulary.academicYear.toLowerCase()}.` : `Your administrator can create this ${schoolVocabulary.academicYear.toLowerCase()}'s terms.`} />}>
      <Card title="Term register">
        <div className={styles.tableViewport}><Table columns={[{ key: "term", header: "Term" }, { key: "school", header: "School" }, { key: "dates", header: "Dates" }, { key: "status", header: "Status" }, { key: "reason", header: "Last transition reason" }, { key: "actions", header: "Actions" }]}
          rows={terms.map((term) => ({
            term: <><strong>{term.name}</strong><div className={styles.secondary}>{term.academicYear}</div></>,
            school: schools.find((school) => school.id === term.collegeId)?.name ?? "School",
            dates: <span className="num">{term.startsOn} – {term.endsOn}</span>,
            status: <><StatusBadge status={term.status === "open" ? "good" : "neutral"}>{term.status === "open" ? "Open" : "Closed"}</StatusBadge>{term.status === "closed" ? <div className={styles.secondary}>{term.marksReleasedAt ? "Marks released" : "Marks private"}</div> : null}</>,
            reason: term.closedReason ?? "—",
            actions: <div className={styles.rowActions}><Button variant="ghost" size="sm" onClick={() => setConfiguring(term)}>Assessment types</Button>{admin ? <><Button variant="ghost" size="sm" onClick={() => { setTarget(term); setReason(""); setSaveError(null); }}>{term.status === "open" ? "Close term" : "Reopen term"}</Button>{term.status === "closed" && !term.marksReleasedAt ? <Button variant="ghost" size="sm" onClick={() => { setReleaseTarget(term); setSaveError(null); }}>Release marks</Button> : null}</> : <span>Read only</span>}</div>,
          }))} /></div>
      </Card>
    </AsyncState>
    <Modal open={creating} onClose={closeDialog} title="Create academic term" footer={<><Button variant="ghost" onClick={closeDialog} disabled={saving}>Cancel</Button><Button type="submit" form="create-school-term" loading={saving} disabled={!collegeId || !name.trim() || !academicYear.trim() || !startsOn || !endsOn || endsOn < startsOn}>Create term</Button></>}>
      <form id="create-school-term" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <fieldset className={styles.fields} disabled={saving}>
          <Select label={schoolVocabulary.institution} value={collegeId} onChange={(event) => setCollegeId(event.target.value)} options={schools.map((school) => ({ value: school.id, label: school.name }))} />
          <Input label="Term name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder="Term 1" />
          <Input label={schoolVocabulary.academicYear} value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} maxLength={32} required />
          <div className={styles.dateFields}><Input label="Start date" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required /><Input label="End date" type="date" min={startsOn || undefined} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} required error={startsOn && endsOn && endsOn < startsOn ? "End date must be on or after the start date." : undefined} /></div>
        </fieldset>
        {saveError ? <p className="formerror" role="alert">{saveError}</p> : null}
      </form>
    </Modal>
    <Modal open={target !== null} onClose={closeDialog} title={target?.status === "open" ? "Close academic term" : "Reopen academic term"}
      footer={<><Button variant="ghost" onClick={closeDialog} disabled={saving}>Cancel</Button><Button loading={saving} disabled={target?.status === "closed" && !reason.trim()} onClick={() => void transition()}>{target?.status === "open" ? "Confirm closure" : "Confirm reopening"}</Button></>}>
      <p>{target?.name} · {target?.academicYear}</p>
      <p className={styles.secondary}>{target?.status === "closed" ? "A reason is required and will be recorded in the audit log. Reopening hides this term's marks from student and family views while corrections are made." : "Closing makes marks read-only and releases this term's current results to linked students and guardians with marks access. Review every score first; missing marks will show as incomplete. Reopening with an audited reason hides the term while corrections are made."}</p>
      <Input label={target?.status === "closed" ? "Reopening reason" : "Closure reason (optional)"} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={saving} required={target?.status === "closed"} />
      {saveError ? <p className="formerror" role="alert">{saveError}</p> : null}
    </Modal>
    <Modal open={releaseTarget !== null} onClose={closeDialog} title="Release closed term marks" footer={<><Button variant="ghost" onClick={closeDialog} disabled={saving}>Cancel</Button><Button loading={saving} onClick={() => void releaseMarks()}>Release marks</Button></>}>
      <p>{releaseTarget?.name} · {releaseTarget?.academicYear}</p>
      <p className={styles.secondary}>This term was closed before marks release was available. Review its scores first. Releasing shows current results to linked students and guardians with marks access; incomplete subjects remain clearly marked.</p>
      {saveError ? <p className="formerror" role="alert">{saveError}</p> : null}
    </Modal>
    {configuring ? <AssessmentTypesEditor key={configuring.id} term={configuring} admin={admin} onClose={() => setConfiguring(null)} /> : null}
  </>;
}
