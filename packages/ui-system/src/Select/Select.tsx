"use client";
import { useId, type SelectHTMLAttributes } from "react";
import styles from "./Select.module.css";

export function Select({
  label, hint, error, id, className, options, ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string; hint?: string; error?: string; options: { value: string; label: string }[];
}) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={styles.label}>{label}</label>
      <select id={selectId} className={[styles.select, className ?? ""].join(" ")} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint !== undefined && error === undefined ? <p className={styles.hint}>{hint}</p> : null}
      {error !== undefined ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
