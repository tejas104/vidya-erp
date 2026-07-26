import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export function PageHeader({
  title,
  breadcrumb,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  breadcrumb?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <div>
        {breadcrumb !== undefined ? <div className={styles.breadcrumb}>{breadcrumb}</div> : null}
        {eyebrow !== undefined ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
