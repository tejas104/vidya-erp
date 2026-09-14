"use client";
import { useId, useMemo, useRef, type KeyboardEvent } from "react";
import { Button, Card } from "@vidya/ui-system";
import styles from "./ScoreEntryCard.module.css";

export interface ScoreEntryStudent {
  id: string;
  fullName: string;
  admissionNo?: string;
}

export interface ScoreEntry {
  studentId: string;
  score: number;
}

interface ScoreEntryCardProps {
  title: string;
  roster: ScoreEntryStudent[];
  /** Raw input text per student id — blank/missing means "not yet entered". */
  values: Record<string, string>;
  maxScore: number;
  onChange: (studentId: string, value: string) => void;
  /** Called with only the rows that have a value; never called while a row is in error. */
  onSave: (entries: ScoreEntry[]) => void;
  saving?: boolean;
  error?: string | null;
}

/** Empty is "not yet entered" (no error, excluded from progress + save).
 * Non-empty must be a finite number within [0, max] — surfaced inline per row. */
export function validateScore(raw: string, max: number): string | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a number.";
  if (n < 0 || n > max) return `0–${max} only.`;
  return null;
}

/** Teacher fast-path score entry: one numeric input per student, auto-advance
 * on entry, running progress, inline per-row validation, one save. Holds no
 * data of its own — the caller owns the roster and the values. */
export function ScoreEntryCard({ title, roster, values, maxScore, onChange, onSave, saving = false, error = null }: ScoreEntryCardProps) {
  const id = useId();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const rowErrors = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const s of roster) out[s.id] = validateScore(values[s.id] ?? "", maxScore);
    return out;
  }, [roster, values, maxScore]);
  const hasErrors = Object.values(rowErrors).some((e) => e !== null);
  const enteredCount = roster.filter((s) => (values[s.id] ?? "").trim() !== "" && rowErrors[s.id] === null).length;

  function onRowKeyDown(event: KeyboardEvent<HTMLInputElement>, i: number) {
    // Enter/Next (mobile numeric keypads show "next"/"done" via enterKeyHint)
    // and the desktop arrow keys both advance — auto-advance is "on entry",
    // not a separate tap on a Next control. Out-of-range indices are a no-op:
    // ref lookup returns undefined, optional chaining skips the focus() call.
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      inputRefs.current[i + 1]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      inputRefs.current[i - 1]?.focus();
    }
  }

  function submit() {
    if (hasErrors || saving || enteredCount === 0) return;
    onSave(roster.filter((s) => (values[s.id] ?? "").trim() !== "").map((s) => ({ studentId: s.id, score: Number(values[s.id]) })));
  }

  return (
    <Card
      title={title}
      actions={<span className={`num ${styles.progress}`} aria-live="polite">{enteredCount}/{roster.length}</span>}
    >
      <div className={styles.scoreList}>
        {roster.map((s, i) => {
          const rowError = rowErrors[s.id] ?? null;
          return (
            <div key={s.id} className={styles.scoreRow}>
              <span><strong>{s.fullName}</strong> <span className="num">{s.admissionNo}</span></span>
              <span className={styles.scoreInputWrap}>
                <input
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="number"
                  inputMode="numeric"
                  enterKeyHint={i < roster.length - 1 ? "next" : "done"}
                  min={0}
                  max={maxScore}
                  disabled={saving}
                  value={values[s.id] ?? ""}
                  className={styles.scoreInput}
                  onChange={(event) => onChange(s.id, event.target.value)}
                  onKeyDown={(event) => onRowKeyDown(event, i)}
                  aria-label={`score for ${s.fullName}`}
                  aria-invalid={rowError !== null}
                  aria-describedby={rowError !== null ? `${id}-${i}-error` : undefined}
                />
                {rowError !== null ? <span id={`${id}-${i}-error`} className="formerror" role="alert">{rowError}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className={styles.formActions}>
        <Button onClick={submit} loading={saving} disabled={hasErrors || enteredCount === 0}>Save marks</Button>
        {error !== null ? <span className="formerror" role="alert">{error}</span> : null}
      </div>
    </Card>
  );
}
