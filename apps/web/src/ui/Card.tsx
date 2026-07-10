import type { ReactNode } from "react";

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {title !== undefined || actions !== undefined ? (
        <div className="tile-head" style={{ marginBottom: "var(--space-3)" }}>
          {title !== undefined ? <div className="tile-name" style={{ fontSize: 17 }}>{title}</div> : <span />}
          {actions ?? null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
