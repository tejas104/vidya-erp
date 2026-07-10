import type { ReactNode } from "react";

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="state" style={{ textAlign: "center" }}>
      <strong>{title}</strong>
      {message !== undefined ? <> {message}</> : null}
      {action !== undefined ? <div style={{ marginTop: "var(--space-4)" }}>{action}</div> : null}
    </div>
  );
}
