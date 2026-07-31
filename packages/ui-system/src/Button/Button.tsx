"use client";
import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "primary", size = "md", loading = false, disabled, children, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm"; loading?: boolean }) {
  const cls = [styles.btn, styles[variant], size === "sm" ? styles.sm : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} data-variant={variant} disabled={disabled || loading}
      aria-busy={loading || undefined} {...rest}>
      {loading ? "Working…" : children}
    </button>
  );
}
