"use client";
import { useId, type InputHTMLAttributes } from "react";
import styles from "./Input.module.css";

export function Input({
  label, hint, error, id, className, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  const messageId = `${inputId}-message`;
  const description = [describedBy, error !== undefined || hint !== undefined ? messageId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>{label}</label>
      <input id={inputId} className={[styles.input, className ?? ""].join(" ")} aria-invalid={error !== undefined ? true : invalid} aria-describedby={description} {...rest} />
      {hint !== undefined && error === undefined ? <p id={messageId} className={styles.hint}>{hint}</p> : null}
      {error !== undefined ? <p id={messageId} className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
