"use client";
import { usePathname } from "next/navigation";
import type { Edition } from "./editionVocabulary";
import { crumbsFor } from "./navConfig";
import styles from "./Breadcrumbs.module.css";
export function Breadcrumbs({ edition = "college" }: { edition?: Edition }) {
  const crumbs = crumbsFor(usePathname(), edition);
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
