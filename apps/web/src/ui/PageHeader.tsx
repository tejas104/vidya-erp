import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="ui-pagehead">
      <div>
        {eyebrow !== undefined ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {lede !== undefined ? <p className="page-lede">{lede}</p> : null}
      </div>
      {actions !== undefined ? <div className="ui-pagehead-actions">{actions}</div> : null}
    </header>
  );
}
