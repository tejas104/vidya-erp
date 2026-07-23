"use client";
import type { ReactNode } from "react";
import styles from "./Table.module.css";

export interface TableColumn<T> {
  key: keyof T & string;
  header: string;
  sortable?: boolean;
  figure?: boolean;
}

export function Table<T>({
  columns,
  rows,
  sort,
  onSortChange,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  sort?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (key: string) => void;
}) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={col.sortable ? (sort?.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
              >
                {col.sortable ? (
                  <button type="button" className={styles.sortBtn} onClick={() => onSortChange?.(col.key)}>
                    {col.header}
                    {sort?.key === col.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.key} className={col.figure ? styles.figure : undefined} data-figure={col.figure ? "1" : undefined}>
                  {row[col.key] as ReactNode}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
