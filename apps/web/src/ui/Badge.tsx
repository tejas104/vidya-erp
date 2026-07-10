import type { ReactNode } from "react";

type Tone = "neutral" | "good" | "warn" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ui-badge ${tone}`}>{children}</span>;
}
