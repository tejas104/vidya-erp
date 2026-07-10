import type { ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint !== undefined && error === undefined ? <p className="field-hint">{hint}</p> : null}
      {error !== undefined ? (
        <p className="formerror" role="alert" style={{ margin: "4px 0 0" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
