"use client";
import { useId, type InputHTMLAttributes } from "react";
import styles from "./Input.module.css";

export function Input({
  label, hint, error, id, className, ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>{label}</label>
      <input id={inputId} className={[styles.input, className ?? ""].join(" ")} {...rest} />
      {hint !== undefined && error === undefined ? <p className={styles.hint}>{hint}</p> : null}
      {error !== undefined ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
