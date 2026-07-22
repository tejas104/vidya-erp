import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export function PageHeader({
  title,
  breadcrumb,
  actions,
}: {
  title: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <div>
        {breadcrumb !== undefined ? <div className={styles.breadcrumb}>{breadcrumb}</div> : null}
        <h1 className={styles.title}>{title}</h1>
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
