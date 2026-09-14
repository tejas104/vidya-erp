"use client";
import { useEffect, useState } from "react";
import { Button, EmptyState, Input, Modal } from "@vidya/ui-system";
import { api, ApiError, type SchoolTermView } from "./api";
import { AsyncState } from "./AsyncState";
import styles from "./SchoolTermsPage.module.css";

type Draft = { key: string; id?: string; name: string; weight: string };

export function AssessmentTypesEditor({ term, admin, onClose }: { term: SchoolTermView; admin: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [locked, setLocked] = useState(false);
  const canEdit = admin && term.status === "open" && !locked;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setDenied(false);
    api.schoolAssessmentTypes(term.id).then(({ types, locked: frozen }) => {
      if (alive) {
        setLocked(frozen ?? false);
        setRows(types.map((type) => ({ key: type.id, id: type.id, name: type.name, weight: String(type.weight) })));
      }
    }).catch((caught: unknown) => {
      if (!alive) return;
      const forbidden = caught instanceof ApiError && caught.status === 403;
      setDenied(forbidden);
      setError(forbidden ? "You don't have access to this assessment configuration." : "Couldn't load assessment types. Please retry.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [term.id, revision]);

  const total = rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);
  const duplicate = new Set(rows.map((row) => row.name.trim().toLowerCase())).size !== rows.length;
  const valid = rows.length > 0 && total === 100 && !duplicate && rows.every((row) => row.name.trim() && Number.isInteger(Number(row.weight)) && Number(row.weight) > 0 && Number(row.weight) <= 100);

  async function save() {
    if (!canEdit || !valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.schoolSetAssessmentTypes(term.id, rows.map((row) => ({ ...(row.id ? { id: row.id } : {}), name: row.name.trim(), weight: Number(row.weight) })));
      onClose();
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : "Couldn't save assessment types. Please retry.");
    } finally { setSaving(false); }
  }

  function update(key: string, field: "name" | "weight", value: string) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row));
  }

  return <Modal open onClose={() => { if (!saving) onClose(); }} title={`Assessment types — ${term.name}`}
    footer={<><Button variant="ghost" disabled={saving} onClick={onClose}>{canEdit ? "Cancel" : "Done"}</Button>{canEdit ? <Button onClick={() => void save()} loading={saving} disabled={loading || error !== null || !valid}>Save assessment types</Button> : null}</>}>
    <p className={styles.secondary}>Assign whole-number percentage weights totaling 100%. These define the term's assessment distribution.</p>
    {locked ? <p className={styles.secondary}>Assessments already use this weighting plan. It is fixed to keep recorded results reproducible, including after reopening.</p> : term.status === "closed" ? <p className={styles.secondary}>This term is closed. Reopen it to change its assessment types.</p> : null}
    <AsyncState loading={loading} error={error !== null} errorMessage={error} onRetry={denied ? undefined : () => setRevision((value) => value + 1)}>
      {rows.length === 0 ? <EmptyState title="No assessment types configured" body={canEdit ? "Add the assessment types your school uses, such as unit tests, practicals, or annual exams." : "Your administrator can configure assessment types while the term is open."} /> : null}
      <fieldset className={styles.fields} disabled={!canEdit || saving}>
        {rows.map((row, index) => <div key={row.key} className={styles.weightRow}>
          <Input label={`Type ${index + 1} name`} value={row.name} onChange={(event) => update(row.key, "name", event.target.value)} maxLength={120} />
          <Input label={`Type ${index + 1} weight (%)`} type="number" min={1} max={100} step={1} value={row.weight} onChange={(event) => update(row.key, "weight", event.target.value)} />
          {canEdit ? <Button variant="ghost" aria-label={`Remove type ${index + 1}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>Remove</Button> : null}
        </div>)}
        {canEdit ? <Button variant="secondary" disabled={rows.length >= 20} onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), name: "", weight: "" }])}>Add assessment type</Button> : null}
      </fieldset>
      <p role="status" className={styles.secondary}>Total weight: {total}% of 100%{duplicate ? " · Each type needs a unique name." : ""}</p>
      {saveError ? <p className="formerror" role="alert">{saveError}</p> : null}
    </AsyncState>
  </Modal>;
}
