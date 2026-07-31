"use client";
import { usePathname } from "next/navigation";
import { crumbsFor } from "./navConfig";
import styles from "./Breadcrumbs.module.css";
export function Breadcrumbs() {
  const crumbs = crumbsFor(usePathname());
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      {crumbs.map((c, i) => (
        <span key={i} className={styles.crumb}>
          {i > 0 && <span className={styles.sep} aria-hidden="true">/</span>}
          {c.href ? <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
