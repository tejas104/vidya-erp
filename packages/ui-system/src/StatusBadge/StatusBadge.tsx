import type { ReactNode } from "react";
import styles from "./StatusBadge.module.css";

type Status = "good" | "warn" | "danger" | "info" | "neutral";

export function StatusBadge({
  status, children, icon,
}: { status: Status; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={styles.badge} data-status={status}>
      {icon}
      {children}
    </span>
  );
}
