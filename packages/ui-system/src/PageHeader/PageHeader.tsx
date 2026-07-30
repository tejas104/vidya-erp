import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export function PageHeader({
  title,
  breadcrumb,
  eyebrow,
  lede,
  actions,
}: {
  title: ReactNode;
  breadcrumb?: ReactNode;
  eyebrow?: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <div>
        {breadcrumb !== undefined ? <div className={styles.breadcrumb}>{breadcrumb}</div> : null}
        {eyebrow !== undefined ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
        {lede !== undefined ? <p className={styles.lede}>{lede}</p> : null}
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
