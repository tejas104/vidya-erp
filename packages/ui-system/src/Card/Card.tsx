import type { ReactNode } from "react";
import styles from "./Card.module.css";

export function Card({
  title, actions, children,
}: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.card}>
      {title !== undefined || actions !== undefined ? (
        <div className={styles.head}>
          {title !== undefined ? <div className={styles.title}>{title}</div> : <span />}
          {actions ?? null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
