import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export function PageHeader({
  title,
  breadcrumb,
  eyebrow,
  lede,
  actions,
  help,
}: {
  title: ReactNode;
  breadcrumb?: ReactNode;
  eyebrow?: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  /** Presentational slot rendered beside `actions`, e.g. a help button. Purely
   * dumb — PageHeader knows nothing about what it renders. */
  help?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <div>
        {breadcrumb !== undefined ? <div className={styles.breadcrumb}>{breadcrumb}</div> : null}
        {eyebrow !== undefined ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
        {lede !== undefined ? <p className={styles.lede}>{lede}</p> : null}
      </div>
      {actions !== undefined || help !== undefined ? (
        <div className={styles.actions}>
          {actions}
          {help}
        </div>
      ) : null}
    </header>
  );
}
